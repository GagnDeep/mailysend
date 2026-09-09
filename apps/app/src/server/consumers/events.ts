import type { NormalizedEvent } from '@mailysend/contracts'
import { ANALYTICS_DATASETS, doName, hourKey, r2Key, stableBucket } from '@mailysend/core'
import {
  type CloudflareEmailEvent,
  consumeEvents,
  extractResendEmailId,
  extractSesEmailId,
  normalizeCloudflareEvent,
  normalizeDsn,
  normalizeResendEvent,
  normalizeSesNotification,
  parseDsn,
  type ResendWebhookEvent,
  type SesNotification,
} from '@mailysend/events'
import type { QueueBatch } from '@mailysend/platform'
import { tenancyFor } from '../context.ts'
import type { Env } from '../env.ts'

/**
 * The single event consumer.
 *
 * Every ingress — Cloudflare's Queues event subscription, SES's SNS
 * notifications, Resend's webhooks, SMTP DSNs, and our own internal `sent` and
 * open/click events — normalizes into one schema before it gets here, so there
 * is exactly one place where a status is written, a rollup is bumped and a
 * webhook is fanned out. Adding a fifth provider adds an adapter, not a branch
 * in this file.
 */

export type EventJob =
  | { source: 'normalized'; events: NormalizedEvent[] }
  | { source: 'cloudflare'; workspace_id: string; payload: unknown }
  | { source: 'ses'; workspace_id: string; payload: unknown }
  | { source: 'resend'; workspace_id: string; payload: unknown }
  | { source: 'dsn'; workspace_id: string; delivery_status: string; original_headers?: string }

export async function consumeEventQueue(batch: QueueBatch<EventJob>, env: Env): Promise<void> {
  // Group by workspace so each group is one `db.batch()` — that is the whole
  // point of the design: 100 events become ~6 writes, not 600.
  const byWorkspace = new Map<string, NormalizedEvent[]>()

  for (const message of batch.messages) {
    try {
      for (const event of await normalize(message.body)) {
        const list = byWorkspace.get(event.workspace_id) ?? []
        list.push(event)
        byWorkspace.set(event.workspace_id, list)
      }
      message.ack()
    } catch (err) {
      console.error('[events] normalization failed', err)
      // A payload we cannot parse will never parse. Retrying it forever would
      // block the batch behind a permanently broken message.
      if (message.attempts >= 3) {
        await env.BUCKET.put(
          r2Key.deadLetter('ms-events', `${Date.now()}-${message.id}`),
          JSON.stringify({ body: message.body, error: String(err) }),
        )
        message.ack()
      } else {
        message.retry({ delaySeconds: 10 })
      }
    }
  }

  for (const [workspaceId, events] of byWorkspace) {
    const sql = tenancyFor(env).db(workspaceId)
    await consumeEvents(events, {
      sql,
      kv: env.CACHE,
      blob: env.BUCKET,
      ...(env.EMAIL_EVENTS ? { analytics: env.EMAIL_EVENTS } : {}),
      eventDetail: env.EVENT_DETAIL !== 'off',
      onWebhook: async (toFanOut) => {
        await fanOut(env, workspaceId, toFanOut)
      },
    })

    // The live dashboard reads from the hub actor's WebSocket, not by polling.
    const hub = env.WORKSPACE_HUB.get(doName('WorkspaceHub', workspaceId))
    await hub.publish(
      events.map((e) => ({ type: e.type, email_id: e.email_id, at: e.occurred_at })),
    )
  }
}

async function normalize(job: EventJob): Promise<NormalizedEvent[]> {
  switch (job.source) {
    case 'normalized':
      return job.events
    case 'cloudflare': {
      const raw = job.payload as CloudflareEmailEvent
      // Our id rides in `metadata` when Cloudflare echoes it back; otherwise the
      // correlation happens downstream on `provider_message_id`, which is why
      // that column is indexed.
      const emailId = raw.metadata?.mailysend_id ?? null
      return [await normalizeCloudflareEvent(raw, { workspaceId: job.workspace_id, emailId })]
    }
    case 'ses': {
      const notification = job.payload as SesNotification
      return normalizeSesNotification(notification, {
        workspaceId: job.workspace_id,
        emailId: extractSesEmailId(notification),
      })
    }
    case 'resend': {
      const event = job.payload as ResendWebhookEvent
      return normalizeResendEvent(event, {
        workspaceId: job.workspace_id,
        emailId: extractResendEmailId(event),
      })
    }
    case 'dsn':
      return normalizeDsn(parseDsn(job.delivery_status, job.original_headers), {
        workspaceId: job.workspace_id,
        occurredAt: new Date().toISOString(),
      })
  }
}

/**
 * Webhook fan-out.
 *
 * One queue message per (endpoint, event) rather than per event: endpoints
 * fail independently, and a customer whose handler is down must not delay
 * deliveries to a customer whose handler is up.
 */
async function fanOut(env: Env, workspaceId: string, events: NormalizedEvent[]): Promise<void> {
  const sql = tenancyFor(env).db(workspaceId)
  const { results: endpoints } = await sql
    .prepare(
      `SELECT id, url, events, secret FROM webhook_endpoints
        WHERE workspace_id = ? AND status = 'enabled'`,
    )
    .bind(workspaceId)
    .all<{ id: string; url: string; events: string; secret: string }>()
  if (endpoints.length === 0) return

  const jobs: { body: unknown }[] = []
  for (const endpoint of endpoints) {
    const subscribed: string[] = JSON.parse(endpoint.events)
    for (const event of events) {
      const name = `email.${event.type}`
      if (!subscribed.includes(name) && !subscribed.includes('*')) continue
      jobs.push({
        body: {
          workspace_id: workspaceId,
          endpoint_id: endpoint.id,
          event_id: event.event_id,
          type: name,
          created_at: event.occurred_at,
          data: event,
        },
      })
    }
  }
  if (jobs.length > 0) await env.WEBHOOKS_QUEUE.sendBatch(jobs)
}

/**
 * Staging for the long-term archive.
 *
 * Analytics Engine keeps three months and samples; the docs promise retention
 * measured in years. So every event is also appended as NDJSON under `stage/`,
 * compacted into parquet monthly, and the staging prefix expires at 3 days.
 */
export async function stageForArchive(
  env: Env,
  workspaceId: string,
  events: NormalizedEvent[],
): Promise<void> {
  if (events.length === 0) return
  const hour = hourKey()
  const shard = String(stableBucket(events[0]!.event_id, 8))
  const key = r2Key.eventStage(workspaceId, hour, `${shard}-${Date.now()}`)
  await env.BUCKET.put(key, events.map((e) => JSON.stringify(e)).join('\n'), {
    httpMetadata: { contentType: 'application/x-ndjson' },
  })
}

export { ANALYTICS_DATASETS }
