import { DEFAULT_WORKSPACE, monthKey, r2Key } from '@mailysend/core'
import { tenancyFor } from './context.ts'
import type { Env } from './env.ts'
import { reclaimStuckSends } from './send/consumer.ts'

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
      // Nothing hourly of our own. `SegmentActor` arms its own alarm on the
      // hour boundary and re-arms it after each firing, on Workers and on Node
      // alike — the cron task that used to be here duplicated that, called a
      // `sweep()` the actor does not have, and selected a `segments.live`
      // column that has never existed, so every hourly tick since the first
      // deploy has thrown `no such column: live` and done nothing else.
      break
    case '0 3 * * *':
      await dailyMaintenance(env)
      break
    default:
      await sweepExpired(env)
  }
}

/**
 * Everything with an expiry. Cheap, indexed, bounded.
 *
 * The auth tables are here for a reason beyond tidiness: a spent WebAuthn
 * challenge, an expired login code and a stale device code are all credentials
 * that have stopped being useful but have not stopped existing, and a table
 * that only ever grows eventually makes the lookup that guards a sign-in slow.
 * Each of these has an index on the column being compared.
 */
async function sweepExpired(env: Env): Promise<void> {
  const sql = tenancyFor(env).db(DEFAULT_WORKSPACE)
  const now = new Date().toISOString()
  // Sends whose worker died holding the lease. Not an expiry like the rest of
  // this function, but it belongs on the same minute tick: a message stuck at
  // `sending` is invisible to every other mechanism we have.
  await reclaimStuckSends(env, DEFAULT_WORKSPACE).catch((err) => {
    console.error('[cron] could not reclaim stuck sends', err)
  })
  await sql.batch([
    sql.prepare('DELETE FROM idempotency_keys WHERE expires_at < ?').bind(now),
    sql
      .prepare('DELETE FROM suppressions WHERE expires_at IS NOT NULL AND expires_at < ?')
      .bind(now),
    sql.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    sql.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').bind(now),
    sql.prepare('DELETE FROM device_codes WHERE expires_at < ?').bind(now),
    // Login codes outlive their expiry by an hour on purpose: the per-address
    // and per-IP rate limits count rows in the last hour, and deleting them the
    // moment they expire would reset the limit ten minutes after each request.
    sql
      .prepare('DELETE FROM login_codes WHERE expires_at < ?')
      .bind(new Date(Date.now() - 60 * 60_000).toISOString()),
    // A claim nonce is a bypass of the entire authentication system for as long
    // as it sits in the table. Ten minutes, and the endpoint checks the age too.
    sql
      .prepare('DELETE FROM claim_nonces WHERE created_at < ?')
      .bind(new Date(Date.now() - 10 * 60_000).toISOString()),
    // Snooze is a timestamp, not a folder, so nothing has to move for a
    // conversation to come back — the thread list already hides a snoozed
    // thread until its time passes. Clearing the stamp is what puts it back in
    // the counts, and doing it on the minute tick is what makes "snooze until
    // 9am" mean 9am.
    sql.prepare('UPDATE mail_threads SET snoozed_until = NULL WHERE snoozed_until <= ?').bind(now),
  ])
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

  // Trash is a soft delete with an expiry date, which is the only kind worth
  // having: a message deleted by a misplaced `#` is recoverable for thirty days
  // and then genuinely gone, rather than living forever in a table nobody
  // reads. The messages go with the threads; their bodies age out under the
  // raw-message retention setting like every other stored body.
  const trashCutoff = new Date(Date.now() - 30 * 86_400_000).toISOString()
  await sql.batch([
    sql
      .prepare(
        `DELETE FROM mail_attachments WHERE thread_id IN
           (SELECT id FROM mail_threads WHERE folder = 'trash' AND updated_at < ?)`,
      )
      .bind(trashCutoff),
    sql
      .prepare(
        `DELETE FROM mail_search WHERE thread_id IN
           (SELECT id FROM mail_threads WHERE folder = 'trash' AND updated_at < ?)`,
      )
      .bind(trashCutoff),
    sql
      .prepare(
        `DELETE FROM mail_messages WHERE thread_id IN
           (SELECT id FROM mail_threads WHERE folder = 'trash' AND updated_at < ?)`,
      )
      .bind(trashCutoff),
    sql
      .prepare("DELETE FROM mail_threads WHERE folder = 'trash' AND updated_at < ?")
      .bind(trashCutoff),
  ])

  // Compaction of the NDJSON staging prefix into the monthly parquet archive.
  await env.EXPORT_QUEUE.send({
    type: 'compact',
    workspace_id: DEFAULT_WORKSPACE,
    month: monthKey(new Date(Date.now() - 86_400_000)),
    prefix: r2Key.eventStage(DEFAULT_WORKSPACE, '', '').replace(/\/$/, ''),
  })
}
