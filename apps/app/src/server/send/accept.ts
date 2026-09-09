import { apiError, type SendEmailRequest } from '@mailysend/contracts'
import {
  kvKey,
  MAX_SCHEDULE_MS,
  newId,
  normalizeForSuppression,
  parseAddress,
  parseAddresses,
  parseScheduledAt,
  r2Key,
  rootDomain,
} from '@mailysend/core'
import type { Ctx } from '../context.ts'
import { type Envelope, INLINE_LIMIT, type SendJob } from './envelope.ts'

/**
 * The synchronous half of the send path.
 *
 * Everything here is cheap and deterministic: authenticate, validate, reserve
 * idempotency, check the domain, check suppressions, resolve the schedule,
 * **mint the id**, spool, insert, enqueue, return. No provider is contacted.
 *
 * The id being minted *here* — before anything touches a network — is the
 * decision the whole multi-provider design rests on. The id we hand back is
 * ours, so it survives a failover, a provider migration, and a provider that
 * loses its own id. `provider_message_id` is recorded later and is queryable,
 * but it is never the identity of a message.
 */

export interface AcceptResult {
  id: string
  created_at: string
  /** Recipients dropped because they were suppressed, if any survived. */
  suppressed: string[]
}

interface DomainRow {
  id: string
  name: string
  status: string
  dkim_selector: string
  dkim_private_key: string | null
  custom_return_path: string
  open_tracking: number
  click_tracking: number
}

/** Resolve and cache the sending domain for a `from` address. */
async function resolveDomain(ctx: Ctx, fromAddress: string): Promise<DomainRow> {
  const parsed = parseAddress(fromAddress)
  if (!parsed) throw apiError('invalid_from_address', { param: 'from' })
  const domain = parsed.address.split('@')[1]?.toLowerCase()
  if (!domain) throw apiError('invalid_from_address', { param: 'from' })

  const cacheKey = kvKey.domain(ctx.workspace.id, domain)
  let row = await ctx.cache.get<DomainRow>(cacheKey, 'json')
  if (!row) {
    // A subdomain send (`mail.example.com`) is legitimate on a verified apex,
    // so fall back to the registrable domain rather than rejecting it.
    row =
      (await ctx.sql
        .prepare(
          `SELECT id, name, status, dkim_selector, dkim_private_key, custom_return_path,
                  open_tracking, click_tracking
             FROM domains WHERE workspace_id = ? AND name IN (?, ?)
            ORDER BY length(name) DESC LIMIT 1`,
        )
        .bind(ctx.workspace.id, domain, rootDomain(domain))
        .first<DomainRow>()) ?? null
    if (row) await ctx.cache.put(cacheKey, JSON.stringify(row), { expirationTtl: 300 })
  }

  if (!row) {
    throw apiError('invalid_from_address', {
      message: `The domain \`${domain}\` is not registered in this workspace. Add it under Domains, or send from a verified domain.`,
      param: 'from',
    })
  }
  if (row.status !== 'verified' && ctx.actor.environment === 'live') {
    throw apiError('domain_not_verified', {
      message: `\`${row.name}\` is registered but not verified yet. Publish its DNS records, then press Verify.`,
      param: 'from',
    })
  }
  return row
}

/** Suppression is the one KV read on every send, which is why it lives in KV. */
async function filterSuppressed(ctx: Ctx, recipients: string[]): Promise<string[]> {
  const hits = await Promise.all(
    recipients.map(async (address) => {
      const key = kvKey.suppression(ctx.workspace.id, normalizeForSuppression(address))
      return (await ctx.suppressions.get(key)) ? address : null
    }),
  )
  return hits.filter((v): v is string => v !== null)
}

/**
 * Idempotency reservation.
 *
 * The atomic operation is the SQL insert, not the KV write — KV is
 * eventually consistent and two simultaneous retries can both read "absent".
 * `INSERT … ON CONFLICT DO NOTHING` with a changes check is the reservation;
 * KV only caches the completed response so a repeat is cheap.
 */
async function reserveIdempotency(
  ctx: Ctx,
  key: string,
  requestHash: string,
): Promise<{ replay: unknown } | { reserved: true }> {
  const now = new Date()
  const expires = new Date(now.getTime() + 86_400_000).toISOString()

  const res = await ctx.sql
    .prepare(
      `INSERT INTO idempotency_keys (workspace_id, key, request_hash, status, expires_at, created_at)
       VALUES (?, ?, ?, 'in_flight', ?, ?)
       ON CONFLICT (workspace_id, key) DO NOTHING`,
    )
    .bind(ctx.workspace.id, key, requestHash, expires, now.toISOString())
    .run()

  if (res.meta.changes > 0) return { reserved: true }

  const existing = await ctx.sql
    .prepare(
      `SELECT request_hash, response_body, status FROM idempotency_keys
        WHERE workspace_id = ? AND key = ?`,
    )
    .bind(ctx.workspace.id, key)
    .first<{ request_hash: string; response_body: string | null; status: string }>()

  if (!existing) return { reserved: true }
  if (existing.request_hash !== requestHash) throw apiError('idempotency_key_conflict')
  if (existing.status === 'in_flight' || !existing.response_body) {
    throw apiError('concurrent_idempotent_requests')
  }
  return { replay: JSON.parse(existing.response_body) }
}

async function completeIdempotency(ctx: Ctx, key: string, body: unknown): Promise<void> {
  await ctx.sql
    .prepare(
      `UPDATE idempotency_keys SET response_body = ?, status = 'complete'
        WHERE workspace_id = ? AND key = ?`,
    )
    .bind(JSON.stringify(body), ctx.workspace.id, key)
    .run()
}

export interface AcceptOptions {
  idempotencyKey?: string | null
  broadcastId?: string
  automationId?: string
  contactId?: string
}

export async function acceptEmail(
  ctx: Ctx,
  request: SendEmailRequest,
  opts: AcceptOptions = {},
): Promise<AcceptResult> {
  const requestHash = await hashRequest(request)

  if (opts.idempotencyKey) {
    const reservation = await reserveIdempotency(ctx, opts.idempotencyKey, requestHash)
    if ('replay' in reservation) return reservation.replay as AcceptResult
  }

  const domain = await resolveDomain(ctx, request.from)

  const to = parseAddresses(request.to)
  const cc = request.cc ? parseAddresses(request.cc) : []
  const bcc = request.bcc ? parseAddresses(request.bcc) : []
  const all = [...to, ...cc, ...bcc]
  if (all.length === 0) throw apiError('invalid_to_address', { param: 'to' })
  if (all.length > 50) throw apiError('too_many_recipients', { param: 'to' })

  let suppressed: string[] = []
  if (!request.ignore_suppression) {
    suppressed = await filterSuppressed(
      ctx,
      all.map((a) => a.address),
    )
    // If *every* recipient is suppressed the send is refused outright — silently
    // accepting a message with nobody to deliver it to would show up in the
    // dashboard as a delivered email that nobody received.
    if (suppressed.length === all.length) {
      throw apiError('recipient_suppressed', {
        message:
          all.length === 1
            ? `\`${all[0]?.address}\` is on this workspace's suppression list.`
            : 'Every recipient of this message is on the suppression list.',
        param: 'to',
      })
    }
  }

  let scheduledAtIso: string | null = null
  if (request.scheduled_at) {
    const parsed = parseScheduledAt(request.scheduled_at)
    if (!parsed) {
      throw apiError('validation_error', {
        message:
          '`scheduled_at` must be an ISO 8601 timestamp or a relative time like `in 1 hour`.',
        param: 'scheduled_at',
      })
    }
    const delta = parsed.at.getTime() - Date.now()
    if (delta < -60_000) throw apiError('scheduling_in_past', { param: 'scheduled_at' })
    if (delta > MAX_SCHEDULE_MS) throw apiError('scheduling_too_far', { param: 'scheduled_at' })
    scheduledAtIso = parsed.at.toISOString()
  }

  const emailId = newId('email')
  const createdAt = new Date().toISOString()

  const envelope: Envelope = {
    email_id: emailId,
    workspace_id: ctx.workspace.id,
    environment: ctx.actor.environment,
    request: request.ignore_suppression
      ? request
      : { ...request, ...withoutSuppressed(request, suppressed) },
    domain: {
      id: domain.id,
      name: domain.name,
      dkim_selector: domain.dkim_selector,
      dkim_private_key: domain.dkim_private_key,
      return_path: `${domain.custom_return_path}.${domain.name}`,
      open_tracking: Boolean(domain.open_tracking) && request.tracking?.opens !== false,
      click_tracking: Boolean(domain.click_tracking) && request.tracking?.clicks !== false,
    },
    ...(opts.broadcastId ? { broadcast_id: opts.broadcastId } : {}),
    ...(opts.automationId ? { automation_id: opts.automationId } : {}),
    ...(opts.contactId ? { contact_id: opts.contactId } : {}),
    ...(request.provider ? { provider: request.provider } : {}),
    created_at: createdAt,
  }

  const serialized = JSON.stringify(envelope)
  let job: SendJob
  if (serialized.length <= INLINE_LIMIT) {
    job = { kind: 'inline', email_id: emailId, workspace_id: ctx.workspace.id, envelope }
  } else {
    const key = r2Key.spool(ctx.workspace.id, emailId)
    await ctx.blob.put(key, serialized, { httpMetadata: { contentType: 'application/json' } })
    job = { kind: 'spooled', email_id: emailId, workspace_id: ctx.workspace.id, key }
  }

  const status = scheduledAtIso ? 'scheduled' : 'queued'
  await insertMessage(ctx, {
    emailId,
    envelope,
    status,
    scheduledAt: scheduledAtIso,
    createdAt,
    to,
    cc,
    bcc,
    tags: request.tags ?? [],
    sizeBytes: serialized.length,
  })

  if (scheduledAtIso) {
    // Scheduled mail is handed to a shard actor rather than a delayed queue
    // message, because a delayed message cannot be cancelled and `DELETE
    // /v1/emails/:id` has to work.
    await scheduleLater(ctx, emailId, scheduledAtIso, job)
  } else {
    await ctx.env.SEND_QUEUE.send(job)
  }

  const result: AcceptResult = { id: emailId, created_at: createdAt, suppressed }
  if (opts.idempotencyKey) ctx.background(completeIdempotency(ctx, opts.idempotencyKey, result))
  return result
}

function withoutSuppressed(
  request: SendEmailRequest,
  suppressed: string[],
): Partial<SendEmailRequest> {
  if (suppressed.length === 0) return {}
  const drop = new Set(suppressed.map((s) => s.toLowerCase()))
  const keep = (list?: string[]) =>
    list?.filter((entry) => {
      const parsed = parseAddress(entry)
      return parsed
        ? !drop.has(entry.toLowerCase()) && !drop.has(parsed.address.toLowerCase())
        : true
    })
  return {
    to: keep(request.to) ?? request.to,
    ...(request.cc ? { cc: keep(request.cc) } : {}),
    ...(request.bcc ? { bcc: keep(request.bcc) } : {}),
  }
}

async function insertMessage(
  ctx: Ctx,
  args: {
    emailId: string
    envelope: Envelope
    status: string
    scheduledAt: string | null
    createdAt: string
    to: { address: string }[]
    cc: { address: string }[]
    bcc: { address: string }[]
    tags: { name: string; value: string }[]
    sizeBytes: number
  },
): Promise<void> {
  const { emailId, envelope, tags } = args
  const statements = [
    ctx.sql
      .prepare(
        `INSERT INTO messages (
           id, workspace_id, domain_id, from_address, to_addresses, cc_addresses, bcc_addresses,
           reply_to, subject, status, state_rank, environment, broadcast_id, automation_id,
           contact_id, template_id, scheduled_at, size_bytes, created_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        emailId,
        ctx.workspace.id,
        envelope.domain.id,
        envelope.request.from,
        JSON.stringify(args.to.map((a) => a.address)),
        args.cc.length ? JSON.stringify(args.cc.map((a) => a.address)) : null,
        args.bcc.length ? JSON.stringify(args.bcc.map((a) => a.address)) : null,
        envelope.request.reply_to ? JSON.stringify(envelope.request.reply_to) : null,
        envelope.request.subject,
        args.status,
        args.status === 'scheduled' ? 5 : 10,
        envelope.environment,
        envelope.broadcast_id ?? null,
        envelope.automation_id ?? null,
        envelope.contact_id ?? null,
        envelope.request.template_id ?? null,
        args.scheduledAt,
        args.sizeBytes,
        args.createdAt,
      ),
    ...tags.map((tag) =>
      ctx.sql
        .prepare(
          `INSERT INTO message_tags (workspace_id, message_id, name, value) VALUES (?,?,?,?)`,
        )
        .bind(ctx.workspace.id, emailId, tag.name, tag.value),
    ),
  ]
  await ctx.sql.batch(statements)
}

async function scheduleLater(ctx: Ctx, emailId: string, at: string, job: SendJob): Promise<void> {
  const { doName, stableBucket } = await import('@mailysend/core')
  const shard = stableBucket(emailId, 8)
  const stub = ctx.env.SCHEDULE_SHARD.get(doName('ScheduleShard', ctx.workspace.id, shard))
  // The shard holds only the due time; the job itself stays spooled, so the
  // actor's storage does not grow with message size.
  await ctx.blob.put(`sched/${ctx.workspace.id}/${emailId}.json`, JSON.stringify(job))
  await stub.schedule({ emailId, workspaceId: ctx.workspace.id, dueAt: Date.parse(at) })
}

/**
 * The idempotency fingerprint.
 *
 * Deliberately over the whole normalised body: a client that retries with the
 * same key but a changed body has a bug, and returning the first response
 * would hide it. Key order is normalised so that a differently-serialised but
 * identical request still matches.
 */
async function hashRequest(request: unknown): Promise<string> {
  const { sha256Hex } = await import('@mailysend/core')
  return sha256Hex(stableStringify(request))
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}
