import {
  apiError,
  type BroadcastVariant,
  CreateBroadcastRequest,
  SendBroadcastRequest,
} from '@mailysend/contracts'
import { doName, KV_TTL, kvKey, newId, parseScheduledAt, r2Key, stableHash } from '@mailysend/core'
import { COUNTER_SHARDS, RANGE_COUNT } from '@mailysend/durable'
import { z } from 'zod'
import { requireRole, requireScope } from '../auth.ts'
import type { Ctx } from '../context.ts'
import { acceptEmail } from '../send/accept.ts'
import { type App, createRouter, json, page, parseLimit, withContext } from './base.ts'

/**
 * `/v1/broadcasts` — one API call, half a million messages.
 *
 * The endpoint's job is deliberately small: resolve the recipient set to a
 * count and an id range, hand that to `BroadcastActor`, and get out of the way.
 * The coordinator holds 32 cursors and hands out page jobs; nothing on this
 * request path scales with the size of the audience, which is why `send` on a
 * thousand contacts and on five hundred thousand cost the same.
 */

const broadcasts: App = createRouter()

broadcasts.use('*', withContext())

const TestSendRequest = z.object({ to: z.array(z.string().email()).min(1).max(5) })

/** `resources.ts` exports the schemas but no inferred types, so this is the local name. */
type Variant = z.infer<typeof BroadcastVariant>

const DEFAULT_THROTTLE_PER_MINUTE = 1_000

broadcasts.post('/', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'broadcasts:write')
  requireRole(ctx.actor, 'marketer')
  const body = CreateBroadcastRequest.parse(await c.req.json())
  await requireAudience(ctx, body.audience_id, body.segment_id)
  const variants = validateVariants(body.variants)

  const id = newId('broadcast')
  const now = new Date().toISOString()
  const replyTo = body.reply_to
    ? Array.isArray(body.reply_to)
      ? body.reply_to
      : [body.reply_to]
    : null

  await ctx.sql
    .prepare(
      `INSERT INTO broadcasts (id, workspace_id, name, audience_id, segment_id, from_address, reply_to,
                               subject, preview_text, template_id, status, throttle_per_minute,
                               holdout_percent, winner_metric, total_recipients, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, 0, ?, ?)`,
    )
    .bind(
      id,
      ctx.workspace.id,
      body.name ?? null,
      body.audience_id,
      body.segment_id ?? null,
      body.from,
      replyTo ? JSON.stringify(replyTo) : null,
      body.subject,
      body.preview_text ?? null,
      body.template_id ?? null,
      body.throttle_per_minute ?? null,
      body.holdout_percent ?? 0,
      body.winner_metric ?? null,
      now,
      now,
    )
    .run()

  await storeBodies(ctx, id, body, variants)

  // Read back rather than echo the request: the row is the only place that
  // knows what the defaults resolved to, and the dashboard parses this response
  // with the same schema it parses the list with. A hand-assembled subset here
  // is a parse failure there.
  return json(
    { ...toBroadcast(await loadBroadcast(ctx, id)), variants: variants ?? undefined },
    201,
  )
})

broadcasts.get('/', async (c) => {
  const ctx = c.get('ctx')
  const limit = parseLimit(c.req.query('limit'))
  const cursor = c.req.query('cursor')
  const status = c.req.query('status')

  const rows = await ctx.sql
    .prepare(
      `SELECT ${BROADCAST_COLUMNS} FROM broadcasts
        WHERE workspace_id = ?
          ${cursor ? 'AND id < ?' : ''}
          ${status ? 'AND status = ?' : ''}
        ORDER BY id DESC LIMIT ?`,
    )
    .bind(ctx.workspace.id, ...(cursor ? [cursor] : []), ...(status ? [status] : []), limit + 1)
    .all<BroadcastRow>()

  return json(page(rows.results.map(toBroadcast), limit))
})

broadcasts.get('/:id', async (c) => {
  const ctx = c.get('ctx')
  const row = await loadBroadcast(ctx, c.req.param('id'))
  const counts = await readCounters(ctx, row.id)
  const variants = await loadVariants(ctx, row.id)

  const perVariant = variants.map((variant) => ({
    key: variant.key,
    subject: variant.subject,
    weight: variant.weight,
    stats: statsFor(counts, variant.key),
  }))

  return json({
    ...toBroadcast(row),
    stats: statsFor(counts, null, row.total_recipients ?? 0),
    ...(perVariant.length > 0
      ? { variants: perVariant, ab: decideWinner(perVariant, row.winner_metric ?? 'opens') }
      : {}),
  })
})

broadcasts.patch('/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'broadcasts:write')
  requireRole(ctx.actor, 'marketer')
  const row = await loadBroadcast(ctx, c.req.param('id'))
  // Editing a broadcast whose pages are already being rendered would mean two
  // halves of one campaign saying different things, so the draft state is the
  // only editable one.
  if (row.status !== 'draft') throw apiError('broadcast_not_editable')

  const body = CreateBroadcastRequest.partial().parse(await c.req.json())
  const variants = validateVariants(body.variants)
  const replyTo = body.reply_to
    ? Array.isArray(body.reply_to)
      ? body.reply_to
      : [body.reply_to]
    : null
  const now = new Date().toISOString()

  await ctx.sql
    .prepare(
      `UPDATE broadcasts SET name = ?, from_address = ?, reply_to = ?, subject = ?, preview_text = ?,
              template_id = ?, throttle_per_minute = ?, holdout_percent = ?, winner_metric = ?,
              segment_id = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND status = 'draft'`,
    )
    .bind(
      body.name ?? row.name,
      body.from ?? row.from_address,
      replyTo ? JSON.stringify(replyTo) : row.reply_to,
      body.subject ?? row.subject,
      body.preview_text ?? row.preview_text,
      body.template_id ?? row.template_id,
      body.throttle_per_minute ?? row.throttle_per_minute,
      body.holdout_percent ?? row.holdout_percent,
      body.winner_metric ?? row.winner_metric,
      body.segment_id ?? row.segment_id,
      now,
      row.id,
      ctx.workspace.id,
    )
    .run()

  if (body.html || body.text || variants) {
    await storeBodies(
      ctx,
      row.id,
      { subject: body.subject ?? row.subject ?? '', html: body.html, text: body.text },
      variants,
    )
  }

  const fresh = await loadBroadcast(ctx, row.id)
  return json(toBroadcast(fresh))
})

broadcasts.delete('/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'broadcasts:write')
  requireRole(ctx.actor, 'developer')
  const row = await loadBroadcast(ctx, c.req.param('id'))
  if (row.status === 'sending' || row.status === 'sent') throw apiError('broadcast_already_sent')

  await ctx.sql.batch([
    ctx.sql
      .prepare('DELETE FROM broadcast_variants WHERE workspace_id = ? AND broadcast_id = ?')
      .bind(ctx.workspace.id, row.id),
    ctx.sql
      .prepare('DELETE FROM broadcast_sends WHERE workspace_id = ? AND broadcast_id = ?')
      .bind(ctx.workspace.id, row.id),
    ctx.sql
      .prepare('DELETE FROM broadcasts WHERE id = ? AND workspace_id = ?')
      .bind(row.id, ctx.workspace.id),
  ])

  return json({ object: 'broadcast', id: row.id, deleted: true })
})

/**
 * `POST /v1/broadcasts/:id/send`.
 *
 * The recipient set is resolved to three numbers — a count and the lowest and
 * highest contact id — and nothing more. The coordinator splits that id range
 * into 32 contiguous slices and page workers do the keyset queries, so no part
 * of accepting a send enumerates the audience.
 */
broadcasts.post('/:id/send', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'broadcasts:send')
  requireRole(ctx.actor, 'marketer')
  const row = await loadBroadcast(ctx, c.req.param('id'))
  if (row.status !== 'draft' && row.status !== 'scheduled') throw apiError('broadcast_already_sent')

  const body = SendBroadcastRequest.parse(await c.req.json().catch(() => ({})))
  const scheduled = body.scheduled_at ? parseScheduledAt(body.scheduled_at) : null
  if (body.scheduled_at && !scheduled) throw apiError('validation_error', { param: 'scheduled_at' })
  if (scheduled && scheduled.at.getTime() < Date.now())
    throw apiError('scheduling_in_past', { param: 'scheduled_at' })

  const range = await resolveRecipients(ctx, row)
  if (range.total === 0) {
    throw apiError('validation_error', {
      message: 'That audience or segment currently has no subscribed contacts.',
    })
  }

  const now = new Date().toISOString()
  if (scheduled) {
    await ctx.sql
      .prepare(
        `UPDATE broadcasts SET status = 'scheduled', scheduled_at = ?, total_recipients = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ?`,
      )
      .bind(scheduled.at.toISOString(), range.total, now, row.id, ctx.workspace.id)
      .run()
    return json(toBroadcast(await loadBroadcast(ctx, row.id)))
  }

  await ctx.sql
    .prepare(
      `UPDATE broadcasts SET status = 'sending', started_at = ?, total_recipients = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ?`,
    )
    .bind(now, range.total, now, row.id, ctx.workspace.id)
    .run()

  await actorFor(ctx, row.id).prepare({
    broadcastId: row.id,
    workspaceId: ctx.workspace.id,
    throttlePerMinute: row.throttle_per_minute ?? DEFAULT_THROTTLE_PER_MINUTE,
    totalRecipients: range.total,
    minId: range.minId,
    maxId: range.maxId,
  })
  await ctx.cache.delete(kvKey.broadcastFlag(ctx.workspace.id, row.id))

  return json(toBroadcast(await loadBroadcast(ctx, row.id)))
})

broadcasts.post('/:id/pause', async (c) => flip(c.get('ctx'), c.req.param('id'), 'pause'))
broadcasts.post('/:id/resume', async (c) => flip(c.get('ctx'), c.req.param('id'), 'resume'))
broadcasts.post('/:id/cancel', async (c) => flip(c.get('ctx'), c.req.param('id'), 'cancel'))

broadcasts.get('/:id/status', async (c) => {
  const ctx = c.get('ctx')
  const row = await loadBroadcast(ctx, c.req.param('id'))
  const live = await actorFor(ctx, row.id).status()
  const counts = await readCounters(ctx, row.id)

  const state = live.state as {
    startedAt: number | null
    status: string
    totalRecipients: number
  } | null
  const elapsed = state?.startedAt ? Math.max(1, (Date.now() - state.startedAt) / 1000) : 0
  const ranges = (live.ranges ?? []) as {
    start: string
    end: string
    cursor: string
    done: boolean
    dispatched: number
  }[]

  return json({
    object: 'broadcast_status',
    id: row.id,
    status: state?.status ?? row.status,
    total: state?.totalRecipients ?? row.total_recipients,
    dispatched: live.dispatched ?? 0,
    range_count: RANGE_COUNT,
    ranges: ranges.map((range, index) => ({
      index,
      dispatched: range.dispatched,
      cursor: range.cursor || range.start,
      done: range.done,
    })),
    // Throughput is measured against dispatch, not delivery: delivery lags by
    // however long the provider takes, and a rate computed from it would blame
    // the coordinator for the provider's queue.
    per_minute: elapsed > 0 ? Math.round(((live.dispatched ?? 0) / elapsed) * 60) : 0,
    stats: statsFor(counts, null, state?.totalRecipients ?? row.total_recipients ?? 0),
  })
})

/**
 * `POST /v1/broadcasts/:id/test` — up to five addresses, no audience touched.
 *
 * The test send goes through the ordinary `/v1/emails` accept path so that what
 * a reviewer sees is what the campaign will send: same renderer, same tracking
 * rewrite, same suppression rules. Nothing is written to `broadcast_sends`.
 */
broadcasts.post('/:id/test', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'emails:send')
  requireRole(ctx.actor, 'marketer')
  const row = await loadBroadcast(ctx, c.req.param('id'))
  const { to } = TestSendRequest.parse(await c.req.json())

  const variantKey = c.req.query('variant')
  const body = await readBody(ctx, row.id, variantKey)
  if (!row.from_address) throw apiError('missing_required_field', { param: 'from' })
  if (!body.html && !body.text) throw apiError('no_content')

  const sent = await Promise.all(
    to.map(async (address) => {
      const result = await acceptEmail(ctx, {
        from: row.from_address as string,
        to: [address],
        subject: `[test] ${body.subject ?? row.subject ?? ''}`,
        html: body.html,
        text: body.text,
        reply_to: row.reply_to ? (JSON.parse(row.reply_to) as string[]) : undefined,
        tags: [{ name: 'broadcast_test', value: row.id }],
      })
      return { to: address, id: result.id }
    }),
  )

  return json({ object: 'list', data: sent })
})

// ---------------------------------------------------------------------------
// A/B
// ---------------------------------------------------------------------------

/**
 * Two-proportion z-test at p < 0.10 (two-sided, |z| > 1.645).
 *
 * 0.10 rather than the customary 0.05 because the two errors do not cost the
 * same here: calling a winner that was really a tie sends the runner-up subject
 * line to nobody, while failing to call a real winner sends the worse one to
 * everyone in the remaining audience. The looser threshold is deliberate, and
 * anything short of it is reported as inconclusive rather than rounded up into
 * a decision the data does not support.
 */
const Z_THRESHOLD = 1.645

/**
 * Which variant a contact gets.
 *
 * Deterministic on `contact_id + broadcast_id` so that a retried page, a resumed
 * range or a re-render assigns the same person the same variant — an assignment
 * drawn at random would let one contact receive both arms and would make the
 * z-test below a test of nothing. Exported because the page worker, not this
 * module, is where it is applied.
 */
export function assignVariant<T extends { key: string; weight: number }>(
  contactId: string,
  broadcastId: string,
  variants: T[],
): T | null {
  if (variants.length === 0) return null
  const total = variants.reduce((sum, variant) => sum + variant.weight, 0)
  let point = stableHash(`${contactId}${broadcastId}`) % Math.max(1, total)
  for (const variant of variants) {
    point -= variant.weight
    if (point < 0) return variant
  }
  return variants.at(-1) ?? null
}

function zScore(
  successesA: number,
  trialsA: number,
  successesB: number,
  trialsB: number,
): number | null {
  if (trialsA < 1 || trialsB < 1) return null
  const pA = successesA / trialsA
  const pB = successesB / trialsB
  const pooled = (successesA + successesB) / (trialsA + trialsB)
  const variance = pooled * (1 - pooled) * (1 / trialsA + 1 / trialsB)
  if (variance <= 0) return null
  return (pA - pB) / Math.sqrt(variance)
}

interface VariantStats {
  key: string
  stats: { sent: number; opened: number; clicked: number }
}

function decideWinner(variants: VariantStats[], metric: 'opens' | 'clicks') {
  const field = metric === 'clicks' ? 'clicked' : 'opened'
  const ranked = [...variants].sort(
    (a, b) =>
      b.stats[field] / Math.max(1, b.stats.sent) - a.stats[field] / Math.max(1, a.stats.sent),
  )
  const [best, runnerUp] = ranked
  if (!best || !runnerUp)
    return { metric, winner: null, inconclusive: true, reason: 'ab_inconclusive' }

  const z = zScore(best.stats[field], best.stats.sent, runnerUp.stats[field], runnerUp.stats.sent)
  if (z === null || Math.abs(z) < Z_THRESHOLD) {
    return {
      metric,
      winner: null,
      z: z ?? null,
      inconclusive: true,
      reason: 'ab_inconclusive',
      message: 'The difference between the leading variants is not distinguishable from noise yet.',
    }
  }
  return { metric, winner: best.key, z, inconclusive: false }
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

const actorFor = (ctx: Ctx, broadcastId: string) =>
  ctx.env.BROADCAST.get(doName('Broadcast', ctx.workspace.id, broadcastId))

/**
 * Pause, resume and cancel all write the KV flag first.
 *
 * A page worker in flight has already left the coordinator behind; the flag is
 * the only thing it re-reads, and its 5s TTL is what bounds how long a paused
 * broadcast keeps sending.
 */
async function flip(
  ctx: Ctx,
  id: string,
  action: 'pause' | 'resume' | 'cancel',
): Promise<Response> {
  requireScope(ctx.actor, 'broadcasts:send')
  requireRole(ctx.actor, 'marketer')
  const row = await loadBroadcast(ctx, id)
  if (row.status === 'sent' || row.status === 'canceled') throw apiError('broadcast_already_sent')

  const status = action === 'pause' ? 'paused' : action === 'resume' ? 'sending' : 'canceled'
  const key = kvKey.broadcastFlag(ctx.workspace.id, row.id)
  if (action === 'resume') await ctx.cache.delete(key)
  else await ctx.cache.put(key, status, { expirationTtl: KV_TTL.broadcastFlag })

  const stub = actorFor(ctx, row.id)
  if (action === 'pause') await stub.pause()
  else if (action === 'resume') await stub.resume()
  else await stub.cancel()

  await ctx.sql
    .prepare('UPDATE broadcasts SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
    .bind(status, new Date().toISOString(), row.id, ctx.workspace.id)
    .run()

  return json(toBroadcast(await loadBroadcast(ctx, row.id)))
}

async function requireAudience(ctx: Ctx, audienceId: string, segmentId?: string): Promise<void> {
  const audience = await ctx.sql
    .prepare('SELECT id FROM audiences WHERE id = ? AND workspace_id = ?')
    .bind(audienceId, ctx.workspace.id)
    .first<{ id: string }>()
  if (!audience)
    throw apiError('not_found', { message: `No audience \`${audienceId}\` in this workspace.` })
  if (!segmentId) return

  const segment = await ctx.sql
    .prepare('SELECT id FROM segments WHERE id = ? AND workspace_id = ? AND audience_id = ?')
    .bind(segmentId, ctx.workspace.id, audienceId)
    .first<{ id: string }>()
  if (!segment) {
    throw apiError('validation_error', {
      message: 'That segment does not belong to the audience named in this broadcast.',
      param: 'segment_id',
    })
  }
}

/** Weights are a share of the test cohort, so anything but 100 is a silent mis-split. */
function validateVariants(variants: Variant[] | undefined): Variant[] | null {
  if (!variants || variants.length === 0) return null
  const total = variants.reduce((sum, variant) => sum + variant.weight, 0)
  if (total !== 100) {
    throw apiError('validation_error', {
      message: `Variant weights must sum to 100; these sum to ${total}.`,
      param: 'variants',
    })
  }
  const keys = new Set(variants.map((variant) => variant.key))
  if (keys.size !== variants.length) {
    throw apiError('validation_error', {
      message: 'Variant keys must be unique.',
      param: 'variants',
    })
  }
  return variants
}

/**
 * Bodies live in R2, not in the row.
 *
 * A page worker fetches the rendered body once and reuses it for its whole
 * page; keeping a two-megabyte HTML body in D1 would mean reading it back on
 * every page query instead.
 */
async function storeBodies(
  ctx: Ctx,
  broadcastId: string,
  body: { subject: string; html?: string; text?: string; preview_text?: string },
  variants: Variant[] | null,
): Promise<void> {
  await ctx.blob.put(
    r2Key.broadcastBody(ctx.workspace.id, broadcastId),
    JSON.stringify({
      subject: body.subject,
      html: body.html ?? null,
      text: body.text ?? null,
      preview_text: body.preview_text ?? null,
    }),
    { httpMetadata: { contentType: 'application/json' } },
  )
  if (!variants) return

  await ctx.sql
    .prepare('DELETE FROM broadcast_variants WHERE workspace_id = ? AND broadcast_id = ?')
    .bind(ctx.workspace.id, broadcastId)
    .run()
  await ctx.sql.batch(
    variants.map((variant) =>
      ctx.sql
        .prepare(
          `INSERT INTO broadcast_variants (id, workspace_id, broadcast_id, key, subject, html, text, weight)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          newId('broadcast'),
          ctx.workspace.id,
          broadcastId,
          variant.key,
          variant.subject,
          variant.html ?? null,
          variant.text ?? null,
          variant.weight,
        ),
    ),
  )
  await Promise.all(
    variants.map((variant) =>
      ctx.blob.put(
        r2Key.broadcastBody(ctx.workspace.id, broadcastId, variant.key),
        JSON.stringify({
          subject: variant.subject,
          html: variant.html ?? body.html ?? null,
          text: variant.text ?? body.text ?? null,
        }),
        { httpMetadata: { contentType: 'application/json' } },
      ),
    ),
  )
}

async function readBody(
  ctx: Ctx,
  broadcastId: string,
  variantKey: string | undefined,
): Promise<{ subject: string | null; html?: string; text?: string }> {
  const object = await ctx.blob.get(
    r2Key.broadcastBody(ctx.workspace.id, broadcastId, variantKey ?? 'default'),
  )
  if (!object) throw apiError('no_content', { message: 'This broadcast has no rendered body yet.' })
  const parsed = (await object.json()) as {
    subject: string | null
    html: string | null
    text: string | null
  }
  return { subject: parsed.subject, html: parsed.html ?? undefined, text: parsed.text ?? undefined }
}

interface RecipientRange {
  total: number
  minId: string
  maxId: string
}

/**
 * One indexed query, three numbers.
 *
 * The segment case reads `segment_members` rather than re-evaluating the
 * expression: membership is maintained continuously, and re-running the
 * predicate here would make accepting a send O(audience).
 */
async function resolveRecipients(ctx: Ctx, row: BroadcastRow): Promise<RecipientRange> {
  const scoped = row.segment_id
    ? `SELECT COUNT(*) AS total, MIN(c.id) AS min_id, MAX(c.id) AS max_id
         FROM segment_members m JOIN contacts c ON c.id = m.contact_id AND c.workspace_id = m.workspace_id
        WHERE m.workspace_id = ? AND m.segment_id = ? AND c.unsubscribed = 0`
    : `SELECT COUNT(*) AS total, MIN(id) AS min_id, MAX(id) AS max_id
         FROM contacts WHERE workspace_id = ? AND audience_id = ? AND unsubscribed = 0`

  const found = await ctx.sql
    .prepare(scoped)
    .bind(ctx.workspace.id, row.segment_id ?? row.audience_id)
    .first<{ total: number; min_id: string | null; max_id: string | null }>()

  return {
    total: Number(found?.total ?? 0),
    minId: found?.min_id ?? '',
    maxId: found?.max_id ?? '',
  }
}

/**
 * Counter keys.
 *
 * Totals are stored unprefixed and per-variant counts under `v:<key>:`, so a
 * broadcast without variants writes and reads exactly the keys it needs and the
 * A/B case costs one extra key per metric rather than a second actor.
 */
const counterKey = (variant: string | null, metric: string): string =>
  variant ? `v:${variant}:${metric}` : metric

const METRICS = [
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained',
  'unsubscribed',
] as const

async function readCounters(ctx: Ctx, broadcastId: string): Promise<Record<string, number>> {
  const shards = await Promise.all(
    Array.from({ length: COUNTER_SHARDS }, (_, shard) =>
      ctx.env.BROADCAST_COUNTER.get(
        doName('BroadcastCounter', ctx.workspace.id, broadcastId, shard),
      )
        .read_()
        .catch(() => ({}) as Record<string, number>),
    ),
  )
  const totals: Record<string, number> = {}
  for (const shard of shards) {
    for (const [key, value] of Object.entries(shard as Record<string, number>)) {
      totals[key] = (totals[key] ?? 0) + Number(value)
    }
  }
  return totals
}

/**
 * `total` is the size of the recipient set, which the counters never hold — it
 * is counted once at preparation and stored on the row. Leaving it out made the
 * response fail the contract, so the progress bar had no denominator at all.
 */
const statsFor = (
  counts: Record<string, number>,
  variant: string | null,
  total = 0,
): Record<(typeof METRICS)[number] | 'total', number> => ({
  total,
  ...(Object.fromEntries(
    METRICS.map((metric) => [metric, counts[counterKey(variant, metric)] ?? 0]),
  ) as Record<(typeof METRICS)[number], number>),
})

interface VariantRow {
  key: string
  subject: string | null
  weight: number
}

const loadVariants = async (ctx: Ctx, broadcastId: string): Promise<VariantRow[]> => {
  const { results } = await ctx.sql
    .prepare(
      'SELECT key, subject, weight FROM broadcast_variants WHERE workspace_id = ? AND broadcast_id = ? ORDER BY key',
    )
    .bind(ctx.workspace.id, broadcastId)
    .all<VariantRow>()
  return results
}

const BROADCAST_COLUMNS = `id, name, audience_id, segment_id, from_address, reply_to, subject, preview_text,
       template_id, status, throttle_per_minute, holdout_percent, winner_metric, winner_variant,
       winner_inconclusive, total_recipients, scheduled_at, started_at, sent_at, created_at, updated_at`

interface BroadcastRow {
  id: string
  name: string | null
  audience_id: string | null
  segment_id: string | null
  from_address: string | null
  reply_to: string | null
  subject: string | null
  preview_text: string | null
  template_id: string | null
  status: string
  throttle_per_minute: number | null
  holdout_percent: number
  winner_metric: 'opens' | 'clicks' | null
  winner_variant: string | null
  winner_inconclusive: number | null
  total_recipients: number
  scheduled_at: string | null
  started_at: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

async function loadBroadcast(ctx: Ctx, id: string): Promise<BroadcastRow> {
  const row = await ctx.sql
    .prepare(`SELECT ${BROADCAST_COLUMNS} FROM broadcasts WHERE id = ? AND workspace_id = ?`)
    .bind(id, ctx.workspace.id)
    .first<BroadcastRow>()
  if (!row) throw apiError('not_found')
  return row
}

const toBroadcast = (row: BroadcastRow) => ({
  object: 'broadcast' as const,
  id: row.id,
  name: row.name,
  audience_id: row.audience_id,
  segment_id: row.segment_id,
  from: row.from_address,
  subject: row.subject,
  preview_text: row.preview_text,
  reply_to: row.reply_to ? (JSON.parse(row.reply_to) as string[]) : null,
  status: row.status,
  throttle_per_minute: row.throttle_per_minute,
  holdout_percent: row.holdout_percent,
  winner_metric: row.winner_metric,
  winner_variant: row.winner_variant,
  ab_inconclusive: row.winner_inconclusive === 1,
  total_recipients: row.total_recipients,
  scheduled_at: row.scheduled_at,
  sent_at: row.sent_at,
  created_at: row.created_at,
})

export { broadcasts }
