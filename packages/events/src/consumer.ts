import type { NormalizedEvent } from '@mailysend/contracts'
import {
  dayKey,
  hourKey,
  KV_TTL,
  kvKey,
  normalizeForSuppression,
  r2Key,
  recipientProvider,
} from '@mailysend/core'
import type { Analytics, Blob, Kv, Sql, SqlStatement } from '@mailysend/platform'
import { classifyBounce, softSuppressionDays } from './bounce.ts'
import { isEngagement, rankFor, stateFor } from './ladder.ts'

/**
 * The normalized event consumer.
 *
 * A batch of 100 events would naively be several hundred database round trips:
 * a status update, an event row, a rollup increment, a contact update and a
 * suppression check each. That does not survive contact with volume — it is
 * both the latency ceiling and, on D1, the dominant line on the bill.
 *
 * Instead, the whole batch is folded in memory first and emitted as roughly six
 * statements in a single `db.batch()`:
 *
 *   1. message status updates (guarded by the monotonic state ladder)
 *   2. event rows
 *   3. daily rollup upserts
 *   4. hourly rollup upserts
 *   5. contact engagement updates
 *   6. suppression inserts
 *
 * Everything that can be done without the database — deduplication, bounce
 * classification, analytics, R2 staging — happens before the batch is built.
 */

export interface ConsumeContext {
  sql: Sql
  kv: Kv
  blob?: Blob
  analytics?: Analytics
  /** Turning this off reconstructs timelines from the R2 archive on demand. */
  eventDetail?: boolean
  /** Called with events that should fan out to customer webhooks. */
  onWebhook?: (events: NormalizedEvent[]) => Promise<void> | void
}

export interface ConsumeResult {
  received: number
  deduped: number
  written: number
  statements: number
  suppressed: number
}

export async function consumeEvents(
  events: NormalizedEvent[],
  ctx: ConsumeContext,
): Promise<ConsumeResult> {
  if (events.length === 0) {
    return { received: 0, deduped: 0, written: 0, statements: 0, suppressed: 0 }
  }

  // --- 1. Dedupe -----------------------------------------------------------
  // The event_id is deterministic, so a redelivered provider webhook produces
  // the same id and is dropped here without touching the database at all. The
  // unique constraint on message_events is the real guarantee; this is the
  // cheap path that keeps the common case off SQL entirely.
  const seen = new Set<string>()
  const fresh: NormalizedEvent[] = []
  for (const event of events) {
    if (seen.has(event.event_id)) continue
    seen.add(event.event_id)
    const already = await ctx.kv.get(kvKey.eventDedupe(event.event_id))
    if (already) continue
    fresh.push(event)
  }
  const deduped = events.length - fresh.length
  if (fresh.length === 0) {
    return { received: events.length, deduped, written: 0, statements: 0, suppressed: 0 }
  }

  // --- 2. Analytics Engine -------------------------------------------------
  // Fire-and-forget, before anything that can fail. AE is the hot query layer
  // for the dashboard's charts, never the count of record: it samples under
  // load and retains only three months.
  if (ctx.analytics) {
    for (const event of fresh) {
      const domain = event.recipient.split('@')[1] ?? ''
      ctx.analytics.writeDataPoint({
        // Exactly one index is allowed, so it has to be the dimension every
        // query filters on. Everything else goes in blobs.
        indexes: [event.workspace_id],
        blobs: [
          event.type,
          event.provider,
          domain,
          recipientProvider(domain),
          event.audience_class ?? '',
          event.bounce_class ?? '',
          event.broadcast_id ?? '',
          event.automation_id ?? '',
          event.email_id ?? '',
        ],
        doubles: [1, new Date(event.occurred_at).getTime()],
      })
    }
  }

  // --- 3. R2 staging -------------------------------------------------------
  // The archive is written from here rather than from AE, because AE samples
  // and would therefore disagree with the dashboard's own numbers. This NDJSON
  // is compacted into parquet later and is what backs the retention promise
  // beyond AE's three months.
  if (ctx.blob) {
    const byHour = new Map<string, NormalizedEvent[]>()
    for (const event of fresh) {
      const key = `${event.workspace_id}|${hourKey(new Date(event.occurred_at))}`
      const bucket = byHour.get(key)
      if (bucket) bucket.push(event)
      else byHour.set(key, [event])
    }
    await Promise.all(
      [...byHour.entries()].map(([key, bucket]) => {
        const [workspaceId, hour] = key.split('|') as [string, string]
        const shard = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        return ctx.blob!.put(
          r2Key.eventStage(workspaceId, hour, shard),
          bucket.map((e) => JSON.stringify(e)).join('\n'),
          { httpMetadata: { contentType: 'application/x-ndjson' } },
        )
      }),
    )
  }

  // --- 4. Fold the batch ---------------------------------------------------
  const statusUpdates = new Map<string, { rank: number; event: NormalizedEvent }>()
  const rollupDaily = new Map<string, Record<string, number>>()
  const rollupHourly = new Map<string, Record<string, number>>()
  const contactUpdates = new Map<
    string,
    { opens: number; clicks: number; lastOpen?: string; lastClick?: string; bounces: number }
  >()
  const suppressionRows: {
    workspaceId: string
    email: string
    original: string
    reason: string
    source: string
    expiresAt: string | null
  }[] = []

  for (const event of fresh) {
    // Keep only the highest-ranked event per message: within one batch there is
    // no point writing `sent` and then `delivered` to the same row.
    if (event.email_id) {
      const rank = rankFor(event.type)
      const held = statusUpdates.get(event.email_id)
      if (!held || rank > held.rank) statusUpdates.set(event.email_id, { rank, event })
    }

    const day = dayKey(new Date(event.occurred_at))
    const hour = hourKey(new Date(event.occurred_at))
    const dKey = `${event.workspace_id}|${day}`
    const hKey = `${event.workspace_id}|${hour}`
    const dRow = rollupDaily.get(dKey) ?? {}
    const hRow = rollupHourly.get(hKey) ?? {}

    const bump = (row: Record<string, number>, column: string, by = 1) => {
      row[column] = (row[column] ?? 0) + by
    }

    switch (event.type) {
      case 'sent':
        bump(dRow, 'sent')
        bump(hRow, 'sent')
        break
      case 'delivered':
        bump(dRow, 'delivered')
        bump(hRow, 'delivered')
        break
      case 'delivery_delayed':
        bump(dRow, 'delayed')
        break
      case 'bounced':
        bump(dRow, 'bounced')
        bump(hRow, 'bounced')
        break
      case 'complained':
        bump(dRow, 'complained')
        bump(hRow, 'complained')
        break
      case 'failed':
      case 'rejected':
        bump(dRow, 'failed')
        bump(hRow, 'failed')
        break
      case 'opened':
        // Only human opens move the headline number. MPP and proxy pre-fetches
        // are counted separately so the dashboard can show both and explain
        // the difference rather than quietly picking one.
        if (event.audience_class === 'human') {
          bump(dRow, 'opened')
          bump(hRow, 'opened')
        } else if (event.audience_class === 'mpp') {
          bump(dRow, 'mpp_opened')
        } else {
          bump(dRow, 'bot_opened')
        }
        break
      case 'clicked':
        if (event.audience_class === 'human') {
          bump(dRow, 'clicked')
          bump(hRow, 'clicked')
        }
        break
      case 'unsubscribed':
        bump(dRow, 'unsubscribed')
        break
    }
    rollupDaily.set(dKey, dRow)
    rollupHourly.set(hKey, hRow)

    // Contact engagement. These are the denormalised columns that make
    // `opened_last_30d` an indexed comparison instead of a join.
    if (event.contact_id && isEngagement(event.type) && event.audience_class === 'human') {
      const key = `${event.workspace_id}|${event.contact_id}`
      const held = contactUpdates.get(key) ?? { opens: 0, clicks: 0, bounces: 0 }
      if (event.type === 'opened') {
        held.opens++
        held.lastOpen = event.occurred_at
      }
      if (event.type === 'clicked') {
        held.clicks++
        held.lastClick = event.occurred_at
      }
      contactUpdates.set(key, held)
    }
    if (event.contact_id && event.type === 'bounced') {
      const key = `${event.workspace_id}|${event.contact_id}`
      const held = contactUpdates.get(key) ?? { opens: 0, clicks: 0, bounces: 0 }
      held.bounces++
      contactUpdates.set(key, held)
    }

    // Suppression. A complaint always suppresses; a bounce suppresses only when
    // it is permanent — suppressing on a full mailbox would lose a real
    // subscriber for good.
    if (event.type === 'complained') {
      suppressionRows.push({
        workspaceId: event.workspace_id,
        email: normalizeForSuppression(event.recipient),
        original: event.recipient,
        reason: 'complaint',
        source: event.email_id ?? '',
        expiresAt: null,
      })
    } else if (event.type === 'bounced') {
      const classified = classifyBounce({ smtpCode: event.smtp_code, diagnostic: event.diagnostic })
      const softDays = softSuppressionDays(classified.class)
      if (classified.permanent) {
        suppressionRows.push({
          workspaceId: event.workspace_id,
          email: normalizeForSuppression(event.recipient),
          original: event.recipient,
          reason: 'hard_bounce',
          source: event.email_id ?? '',
          expiresAt: null,
        })
      } else if (softDays !== null) {
        suppressionRows.push({
          workspaceId: event.workspace_id,
          email: normalizeForSuppression(event.recipient),
          original: event.recipient,
          reason: 'hard_bounce',
          source: event.email_id ?? '',
          expiresAt: new Date(Date.now() + softDays * 86_400_000).toISOString(),
        })
      }
    } else if (event.type === 'unsubscribed') {
      suppressionRows.push({
        workspaceId: event.workspace_id,
        email: normalizeForSuppression(event.recipient),
        original: event.recipient,
        reason: 'unsubscribe',
        source: event.email_id ?? '',
        expiresAt: null,
      })
    }
  }

  // --- 5. One batch --------------------------------------------------------
  const statements: SqlStatement[] = []

  for (const [emailId, { rank, event }] of statusUpdates) {
    statements.push(
      ctx.sql
        .prepare(
          `UPDATE messages
             SET status = ?, state_rank = ?,
                 delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END,
                 bounce_class = COALESCE(?, bounce_class),
                 smtp_code = COALESCE(?, smtp_code),
                 smtp_response = COALESCE(?, smtp_response)
           WHERE id = ? AND workspace_id = ? AND state_rank < ?`,
        )
        .bind(
          stateFor(event.type),
          rank,
          event.type,
          event.occurred_at,
          event.bounce_class ?? null,
          event.smtp_code ?? null,
          event.smtp_response ?? null,
          emailId,
          event.workspace_id,
          rank,
        ),
    )
  }

  // Open and click counters are separate from the status ladder: they
  // accumulate rather than advance, so they must not be gated on state_rank.
  const counterBumps = new Map<string, { opens: number; clicks: number; workspaceId: string }>()
  for (const event of fresh) {
    if (!event.email_id || event.audience_class !== 'human') continue
    if (event.type !== 'opened' && event.type !== 'clicked') continue
    const held = counterBumps.get(event.email_id) ?? {
      opens: 0,
      clicks: 0,
      workspaceId: event.workspace_id,
    }
    if (event.type === 'opened') held.opens++
    else held.clicks++
    counterBumps.set(event.email_id, held)
  }
  for (const [emailId, bump] of counterBumps) {
    statements.push(
      ctx.sql
        .prepare(
          `UPDATE messages SET open_count = open_count + ?, click_count = click_count + ?
           WHERE id = ? AND workspace_id = ?`,
        )
        .bind(bump.opens, bump.clicks, emailId, bump.workspaceId),
    )
  }

  if (ctx.eventDetail !== false) {
    for (const event of fresh) {
      statements.push(
        ctx.sql
          .prepare(
            `INSERT OR IGNORE INTO message_events
               (event_id, workspace_id, message_id, type, recipient, occurred_at, provider,
                audience_class, link_url, bounce_class, smtp_code, smtp_response, ip, user_agent,
                geo_country, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            event.event_id,
            event.workspace_id,
            event.email_id,
            event.type,
            event.recipient,
            event.occurred_at,
            event.provider,
            event.audience_class ?? null,
            event.link_url ?? null,
            event.bounce_class ?? null,
            event.smtp_code ?? null,
            event.smtp_response ?? null,
            event.ip ?? null,
            event.user_agent ?? null,
            event.geo_country ?? null,
            new Date().toISOString(),
          ),
      )
    }
  }

  for (const [key, row] of rollupDaily) {
    const [workspaceId, day] = key.split('|') as [string, string]
    const columns = Object.keys(row)
    if (columns.length === 0) continue
    statements.push(
      ctx.sql
        .prepare(
          `INSERT INTO rollups_daily (workspace_id, day, domain_id, provider, ${columns.join(', ')})
           VALUES (?, ?, '', '', ${columns.map(() => '?').join(', ')})
           ON CONFLICT(workspace_id, day, domain_id, provider) DO UPDATE SET
             ${columns.map((c) => `${c} = ${c} + excluded.${c}`).join(', ')}`,
        )
        .bind(workspaceId, day, ...columns.map((c) => row[c]!)),
    )
  }

  for (const [key, row] of rollupHourly) {
    const [workspaceId, hour] = key.split('|') as [string, string]
    const columns = Object.keys(row).filter(
      (c) => c !== 'mpp_opened' && c !== 'bot_opened' && c !== 'unsubscribed' && c !== 'delayed',
    )
    if (columns.length === 0) continue
    statements.push(
      ctx.sql
        .prepare(
          `INSERT INTO rollups_hourly (workspace_id, hour, domain_id, ${columns.join(', ')})
           VALUES (?, ?, '', ${columns.map(() => '?').join(', ')})
           ON CONFLICT(workspace_id, hour, domain_id) DO UPDATE SET
             ${columns.map((c) => `${c} = ${c} + excluded.${c}`).join(', ')}`,
        )
        .bind(workspaceId, hour, ...columns.map((c) => row[c]!)),
    )
  }

  for (const [key, update] of contactUpdates) {
    const [workspaceId, contactId] = key.split('|') as [string, string]
    statements.push(
      ctx.sql
        .prepare(
          `UPDATE contacts
             SET open_count = open_count + ?,
                 click_count = click_count + ?,
                 bounce_count = bounce_count + ?,
                 last_open_at = COALESCE(MAX(COALESCE(last_open_at, ''), COALESCE(?, '')), last_open_at),
                 last_click_at = COALESCE(MAX(COALESCE(last_click_at, ''), COALESCE(?, '')), last_click_at),
                 updated_at = ?
           WHERE id = ? AND workspace_id = ?`,
        )
        .bind(
          update.opens,
          update.clicks,
          update.bounces,
          update.lastOpen ?? null,
          update.lastClick ?? null,
          new Date().toISOString(),
          contactId,
          workspaceId,
        ),
    )
    // Mark dirty so segment membership is recomputed by delta rather than by a
    // periodic full scan.
    statements.push(
      ctx.sql
        .prepare(
          `INSERT INTO contact_dirty (workspace_id, contact_id, fields, marked_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(workspace_id, contact_id) DO UPDATE SET fields = excluded.fields, marked_at = excluded.marked_at`,
        )
        .bind(workspaceId, contactId, 'engagement', new Date().toISOString()),
    )
  }

  for (const row of suppressionRows) {
    statements.push(
      ctx.sql
        .prepare(
          `INSERT INTO suppressions (workspace_id, email, original_email, reason, source, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(workspace_id, email) DO UPDATE SET
             reason = excluded.reason,
             expires_at = CASE WHEN excluded.expires_at IS NULL THEN NULL ELSE suppressions.expires_at END`,
        )
        .bind(
          row.workspaceId,
          row.email,
          row.original,
          row.reason,
          row.source,
          row.expiresAt,
          new Date().toISOString(),
        ),
    )
  }

  if (statements.length > 0) await ctx.sql.batch(statements)

  // --- 6. Cache and fan out ------------------------------------------------
  await Promise.all([
    ...fresh.map((e) =>
      ctx.kv.put(kvKey.eventDedupe(e.event_id), '1', { expirationTtl: KV_TTL.eventDedupe }),
    ),
    // Suppressions are mirrored into KV because they are read once per
    // recipient on every send; a database round trip there would dominate.
    ...suppressionRows.map((row) =>
      ctx.kv.put(
        kvKey.suppression(row.workspaceId, row.email),
        JSON.stringify({ reason: row.reason, expires_at: row.expiresAt }),
        row.expiresAt
          ? {
              expirationTtl: Math.max(
                60,
                Math.floor((new Date(row.expiresAt).getTime() - Date.now()) / 1000),
              ),
            }
          : undefined,
      ),
    ),
  ])

  if (ctx.onWebhook) await ctx.onWebhook(fresh)

  return {
    received: events.length,
    deduped,
    written: fresh.length,
    statements: statements.length,
    suppressed: suppressionRows.length,
  }
}
