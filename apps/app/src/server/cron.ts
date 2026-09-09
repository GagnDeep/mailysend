import { DEFAULT_WORKSPACE, doName, monthKey, r2Key } from '@mailysend/core'
import { tenancyFor } from './context.ts'
import type { Env } from './env.ts'

/**
 * Scheduled maintenance.
 *
 * Everything here is idempotent and bounded. A cron that can overrun its own
 * next tick is a cron that eventually runs twice concurrently, so each task
 * either claims its work or does a fixed amount of it.
 */

export async function runCron(cron: string, env: Env): Promise<void> {
  switch (cron) {
    case '* * * * *':
      await sweepExpired(env)
      break
    case '0 * * * *':
      await hourlySegmentSweep(env)
      break
    case '0 3 * * *':
      await dailyMaintenance(env)
      break
    default:
      await sweepExpired(env)
  }
}

/** Idempotency rows and expired suppressions. Cheap, indexed, bounded. */
async function sweepExpired(env: Env): Promise<void> {
  const sql = tenancyFor(env).db(DEFAULT_WORKSPACE)
  const now = new Date().toISOString()
  await sql.batch([
    sql.prepare('DELETE FROM idempotency_keys WHERE expires_at < ?').bind(now),
    sql
      .prepare('DELETE FROM suppressions WHERE expires_at IS NOT NULL AND expires_at < ?')
      .bind(now),
  ])
}

/**
 * The hourly segment boundary sweep.
 *
 * This is the mechanism that makes `last_open < 30d` actually live. Nothing
 * writes to a contact when a relative window expires, so a write-driven delta
 * cannot see it — but only contacts whose timestamp falls in the hour that just
 * expired can have flipped, and that is one indexed range scan per window
 * rather than a table scan.
 */
async function hourlySegmentSweep(env: Env): Promise<void> {
  const sql = tenancyFor(env).db(DEFAULT_WORKSPACE)
  const { results } = await sql
    .prepare('SELECT id FROM segments WHERE workspace_id = ? AND live = 1')
    .bind(DEFAULT_WORKSPACE)
    .all<{ id: string }>()
  for (const segment of results) {
    const actor = env.SEGMENT.get(doName('Segment', DEFAULT_WORKSPACE, segment.id))
    await actor.sweep()
  }
}

async function dailyMaintenance(env: Env): Promise<void> {
  const sql = tenancyFor(env).db(DEFAULT_WORKSPACE)

  // Retention. The default is generous, and it is a setting rather than a
  // constant because the docs promise "keep a day or seven years" and the
  // whole point of self-hosting is that the answer is the operator's.
  const retention = await sql
    .prepare("SELECT value FROM settings WHERE workspace_id = ? AND key = 'log_retention_days'")
    .bind(DEFAULT_WORKSPACE)
    .first<{ value: string }>()
  const days = Number(retention?.value ?? 90)
  if (Number.isFinite(days) && days > 0) {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
    await sql
      .prepare('DELETE FROM message_events WHERE workspace_id = ? AND occurred_at < ?')
      .bind(DEFAULT_WORKSPACE, cutoff)
      .run()
  }

  // Compaction of the NDJSON staging prefix into the monthly parquet archive.
  await env.EXPORT_QUEUE.send({
    type: 'compact',
    workspace_id: DEFAULT_WORKSPACE,
    month: monthKey(new Date(Date.now() - 86_400_000)),
    prefix: r2Key.eventStage(DEFAULT_WORKSPACE, '', '').replace(/\/$/, ''),
  })
}
