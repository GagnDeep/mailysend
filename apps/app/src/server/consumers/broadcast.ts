import { doName, kvKey, r2Key } from '@mailysend/core'
import type { PageJob } from '@mailysend/durable'
import type { QueueBatch } from '@mailysend/platform'
import { buildContext, tenancyFor } from '../context.ts'
import type { Env } from '../env.ts'
import { acceptEmail } from '../send/accept.ts'

/**
 * A broadcast page worker.
 *
 * The coordinator actor never enumerates recipients — it hands out contiguous
 * id ranges and each page worker walks its own with a keyset query. That is
 * what keeps the coordinator's write rate flat (~6/s) whether the audience is
 * a thousand contacts or half a million.
 */

/** Bounded so one page fits comfortably inside a Worker invocation. */
const PAGE_SIZE = 200

export async function consumeBroadcastPages(batch: QueueBatch<PageJob>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const job = message.body
    try {
      const paused = await env.CACHE.get(kvKey.broadcastFlag(job.workspaceId, job.broadcastId))
      if (paused === 'paused') {
        // Park rather than drop: the cursor has not advanced, so resuming
        // re-dispatches this exact page. Nothing is lost and nothing repeats.
        message.retry({ delaySeconds: 15 })
        continue
      }
      if (paused === 'canceled') {
        message.ack()
        continue
      }

      const sent = await sendPage(job, env)
      const coordinator = env.BROADCAST.get(doName('Broadcast', job.workspaceId, job.broadcastId))
      await coordinator.advance(job.rangeIndex, sent.cursor, sent.count, sent.exhausted)
      message.ack()
    } catch (err) {
      console.error('[broadcast] page failed', err)
      if (message.attempts < 5) message.retry({ delaySeconds: 30 })
      else message.ack()
    }
  }
}

async function sendPage(
  job: PageJob,
  env: Env,
): Promise<{ cursor: string; count: number; exhausted: boolean }> {
  const sql = tenancyFor(env).db(job.workspaceId)
  const ctx = await buildContext(
    env,
    { workspaceId: job.workspaceId, environment: 'live', scopes: ['*'] },
    () => {},
  )

  const broadcast = await sql
    .prepare(
      `SELECT audience_id, segment_id, from_address, subject, reply_to
         FROM broadcasts WHERE workspace_id = ? AND id = ?`,
    )
    .bind(job.workspaceId, job.broadcastId)
    .first<{
      audience_id: string | null
      segment_id: string | null
      from_address: string | null
      subject: string | null
      reply_to: string | null
    }>()
  if (!broadcast) throw new Error(`broadcast ${job.broadcastId} no longer exists`)

  const { results: contacts } = await sql
    .prepare(
      `SELECT c.id, c.email, c.first_name, c.last_name, c.data
         FROM contacts c
         ${broadcast.segment_id ? 'JOIN segment_members sm ON sm.contact_id = c.id AND sm.segment_id = ?' : ''}
        WHERE c.workspace_id = ? AND c.audience_id = ?
          AND c.id > ? AND c.id <= ?
          AND c.unsubscribed = 0
        ORDER BY c.id ASC LIMIT ?`,
    )
    .bind(
      ...(broadcast.segment_id ? [broadcast.segment_id] : []),
      job.workspaceId,
      broadcast.audience_id,
      job.after,
      job.until,
      Math.min(job.limit, PAGE_SIZE),
    )
    .all<{
      id: string
      email: string
      first_name: string | null
      last_name: string | null
      data: string | null
    }>()

  if (contacts.length === 0) return { cursor: job.until, count: 0, exhausted: true }

  // The rendered body lives in R2 rather than in a column, because a broadcast
  // body is routinely hundreds of kilobytes and every page worker reads it once
  // per page rather than once per contact.
  const bodyKey = r2Key.broadcastBody(job.workspaceId, job.broadcastId)
  const body = await env.BUCKET.get(bodyKey)
  if (!body) throw new Error(`broadcast body ${bodyKey} is missing`)
  const rendered = (await body.json()) as {
    from: string
    subject: string
    html: string
    text: string
    reply_to?: string[]
  }

  let count = 0
  for (const contact of contacts) {
    // `broadcast_sends` is the duplicate guard. Claiming the row *before*
    // accepting the send means a re-enumerated range cannot send twice, and a
    // crash between the two leaves an unsent claim that the reconciler finds —
    // which is the safe direction to fail.
    const claim = await sql
      .prepare(
        `INSERT INTO broadcast_sends (workspace_id, broadcast_id, contact_id, variant, created_at)
         VALUES (?,?,?,?,?)
         ON CONFLICT (workspace_id, broadcast_id, contact_id) DO NOTHING`,
      )
      .bind(job.workspaceId, job.broadcastId, contact.id, 'default', new Date().toISOString())
      .run()
    if (claim.meta.changes === 0) continue

    try {
      const accepted = await acceptEmail(
        ctx,
        {
          from: rendered.from,
          to: [contact.email],
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          ...(rendered.reply_to ? { reply_to: rendered.reply_to } : {}),
        } as never,
        { broadcastId: job.broadcastId, contactId: contact.id },
      )
      await sql
        .prepare(
          `UPDATE broadcast_sends SET message_id = ?
            WHERE workspace_id = ? AND broadcast_id = ? AND contact_id = ?`,
        )
        .bind(accepted.id, job.workspaceId, job.broadcastId, contact.id)
        .run()
      count++
    } catch (err) {
      // The claim row stays, with `message_id` still null. That is the
      // reconciler's signal — a claimed-but-unsent recipient — and it is the
      // safe direction to fail: nobody gets the message twice, and the ones
      // who got nothing are enumerable.
      console.error(`[broadcast] ${job.broadcastId} → ${contact.id}`, err)
    }
  }

  const counter = env.BROADCAST_COUNTER.get(
    doName('BroadcastCounter', job.workspaceId, job.broadcastId, job.rangeIndex % 16),
  )
  await counter.increment({ sent: count })

  return {
    cursor: contacts.at(-1)!.id,
    count,
    exhausted: contacts.length < Math.min(job.limit, PAGE_SIZE),
  }
}
