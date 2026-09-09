import {
  apiError,
  CreateSuppressionRequest,
  emailAddress,
  SuppressionReason,
} from '@mailysend/contracts'
import { KV_TTL, kvKey, normalizeForSuppression } from '@mailysend/core'
import { z } from 'zod'
import { requireScope } from '../auth.ts'
import type { Ctx } from '../context.ts'
import { type App, createRouter, json, page, parseLimit, withContext } from './base.ts'

/**
 * `/v1/suppressions`.
 *
 * Every row is written twice on purpose: to D1, which is the record of *why*
 * an address is suppressed, and to KV, which is what the send path actually
 * reads. The send path checks one KV key per recipient and must never pay for a
 * database round trip, so the mirror is not a cache — it is the read path, and
 * a write that updates only one of the two is a bug in either direction.
 *
 * Addresses are keyed by their normalised form (`normalizeForSuppression`), so
 * unsubscribing `a.b+news@gmail.com` also stops mail to `ab@gmail.com`. The
 * address the customer actually typed is kept verbatim in `original_email`,
 * because showing someone a normalised address they never entered reads like we
 * lost their data.
 */

const suppressions: App = createRouter()

suppressions.use('*', withContext())

const BulkSuppressionRequest = z.object({
  emails: z
    .array(z.union([emailAddress, CreateSuppressionRequest]))
    .min(1)
    .max(1000),
  reason: SuppressionReason.default('manual'),
  expires_at: z.string().optional(),
})

suppressions.get('/', async (c) => {
  const ctx = c.get('ctx')
  const limit = parseLimit(c.req.query('limit'))
  const cursor = c.req.query('cursor')
  const reason = c.req.query('reason')
  const search = c.req.query('email') ?? c.req.query('search')

  // `suppressions` has no ULID — its primary key is (workspace_id, email) — so
  // the address itself is the cursor and the listing is ordered by it.
  const rows = await ctx.sql
    .prepare(
      `SELECT email, original_email, reason, source, expires_at, created_at
         FROM suppressions
        WHERE workspace_id = ?
          ${cursor ? 'AND email > ?' : ''}
          ${reason ? 'AND reason = ?' : ''}
          ${search ? 'AND (email LIKE ? OR original_email LIKE ?)' : ''}
        ORDER BY email ASC LIMIT ?`,
    )
    .bind(
      ctx.workspace.id,
      ...(cursor ? [cursor] : []),
      ...(reason ? [reason] : []),
      ...(search ? [`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`] : []),
      limit + 1,
    )
    .all<SuppressionRow>()

  return json(page(rows.results.map(toSuppression), limit))
})

suppressions.post('/', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'suppressions:write')
  const body = CreateSuppressionRequest.parse(await c.req.json())
  const row = await suppress(ctx, body.email, body.reason, body.expires_at ?? null)
  return json(toSuppression(row), 201)
})

/**
 * Bulk import — a list migrated from another ESP arrives all at once.
 *
 * Partial failure is not a thing here: an address that is already suppressed is
 * upserted rather than rejected, so re-running an import is safe.
 */
suppressions.post('/bulk', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'suppressions:write')
  const body = BulkSuppressionRequest.parse(await c.req.json())

  const entries = body.emails.map((item) =>
    typeof item === 'string'
      ? { email: item, reason: body.reason, expires_at: body.expires_at ?? null }
      : {
          email: item.email,
          reason: item.reason,
          expires_at: item.expires_at ?? body.expires_at ?? null,
        },
  )

  // Deduplicate on the normalised form: two spellings of the same mailbox in
  // one payload would otherwise be two conflicting upserts of one row.
  const unique = new Map<string, (typeof entries)[number]>()
  for (const entry of entries) unique.set(normalizeForSuppression(entry.email), entry)

  const now = new Date().toISOString()
  const source = ctx.actor.userId ? `user:${ctx.actor.userId}` : 'api'
  const statements = [...unique.entries()].map(([normalized, entry]) =>
    ctx.sql
      .prepare(
        `INSERT INTO suppressions (workspace_id, email, original_email, reason, source, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, email) DO UPDATE SET
           original_email = excluded.original_email, reason = excluded.reason,
           source = excluded.source, expires_at = excluded.expires_at`,
      )
      .bind(ctx.workspace.id, normalized, entry.email, entry.reason, source, entry.expires_at, now),
  )

  // D1 caps a batch well below 1000 statements, so it goes in chunks.
  for (let i = 0; i < statements.length; i += 100) {
    await ctx.sql.batch(statements.slice(i, i + 100))
  }

  await Promise.all(
    [...unique.entries()].map(([normalized, entry]) =>
      writeMirror(ctx, normalized, entry.reason, entry.expires_at),
    ),
  )

  return json({
    object: 'list',
    created: unique.size,
    duplicates: entries.length - unique.size,
    data: [...unique.keys()],
  })
})

suppressions.delete('/:email', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'suppressions:write')
  const raw = decodeURIComponent(c.req.param('email'))
  const normalized = normalizeForSuppression(raw)

  const result = await ctx.sql
    .prepare('DELETE FROM suppressions WHERE workspace_id = ? AND email = ?')
    .bind(ctx.workspace.id, normalized)
    .run()
  if (result.meta.changes === 0) throw apiError('not_found')

  // Awaited: a caller who just un-suppressed an address will send to it on the
  // next line, and a stale mirror would silently drop that message.
  await ctx.suppressions.delete(kvKey.suppression(ctx.workspace.id, normalized))

  return json({ object: 'suppression', email: normalized, deleted: true })
})

async function suppress(
  ctx: Ctx,
  email: string,
  reason: string,
  expiresAt: string | null,
): Promise<SuppressionRow> {
  const normalized = normalizeForSuppression(email)
  const now = new Date().toISOString()
  const source = ctx.actor.userId ? `user:${ctx.actor.userId}` : 'api'

  await ctx.sql
    .prepare(
      `INSERT INTO suppressions (workspace_id, email, original_email, reason, source, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, email) DO UPDATE SET
         original_email = excluded.original_email, reason = excluded.reason,
         source = excluded.source, expires_at = excluded.expires_at`,
    )
    .bind(ctx.workspace.id, normalized, email, reason, source, expiresAt, now)
    .run()

  await writeMirror(ctx, normalized, reason, expiresAt)

  return {
    email: normalized,
    original_email: email,
    reason,
    source,
    expires_at: expiresAt,
    created_at: now,
  }
}

/**
 * The KV mirror. A suppression with an expiry gets a matching TTL so the key
 * disappears on its own — a soft-bounce suppression that outlives its reason is
 * a customer quietly losing a recipient forever.
 */
const writeMirror = (ctx: Ctx, normalized: string, reason: string, expiresAt: string | null) => {
  const ttl = expiresAt ? Math.floor((Date.parse(expiresAt) - Date.now()) / 1000) : null
  return ctx.suppressions.put(
    kvKey.suppression(ctx.workspace.id, normalized),
    JSON.stringify({ reason, expires_at: expiresAt }),
    // KV rejects a TTL under 60s; anything that short has effectively expired.
    ttl !== null && ttl > 60 ? { expirationTtl: Math.min(ttl, KV_TTL.uniqueMarker) } : {},
  )
}

interface SuppressionRow {
  email: string
  original_email: string
  reason: string
  source: string | null
  expires_at: string | null
  created_at: string
}

const toSuppression = (row: SuppressionRow) => ({
  object: 'suppression' as const,
  // The listing paginates on the address, so the address is also the id.
  id: row.email,
  email: row.original_email,
  normalized_email: row.email,
  reason: row.reason,
  source: row.source,
  expires_at: row.expires_at,
  created_at: row.created_at,
})

export { suppressions }
