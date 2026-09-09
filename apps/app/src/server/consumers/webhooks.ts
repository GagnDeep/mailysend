import { doName, newId, signWebhook } from '@mailysend/core'
import type { QueueBatch } from '@mailysend/platform'
import { tenancyFor } from '../context.ts'
import type { Env } from '../env.ts'

/**
 * Webhook delivery.
 *
 * The queue carries the first ~1 hour of retries; anything still failing is
 * handed to `WebhookEndpointActor`, which owns the 3/6/12/24-hour tail. Two
 * mechanisms rather than one because a queue cannot hold a message for a day,
 * and an actor alarm is the wrong tool for a delivery that will succeed on the
 * second try.
 */

export interface WebhookJob {
  workspace_id: string
  endpoint_id: string
  event_id: string
  type: string
  created_at: string
  data: Record<string, unknown>
  /** Set when a delivery is replayed from the dashboard. */
  delivery_id?: string
}

/**
 * The replay endpoint and the event fan-out enqueue the same work under two
 * spellings. Normalising here rather than forcing one on both sides means a
 * message already sitting in the queue during a deploy still delivers.
 */
interface CamelWebhookJob {
  workspaceId: string
  endpointId: string
  eventId: string
  eventType: string
  body: Record<string, unknown>
  deliveryId?: string
  replayOf?: string
}

const normalizeJob = (job: WebhookJob | CamelWebhookJob): WebhookJob =>
  'workspace_id' in job
    ? job
    : {
        workspace_id: job.workspaceId,
        endpoint_id: job.endpointId,
        event_id: job.eventId,
        type: job.eventType,
        created_at: new Date().toISOString(),
        data: job.body,
        ...(job.deliveryId ? { delivery_id: job.deliveryId } : {}),
      }

/** Beyond this the queue gives up and the actor takes over the long tail. */
const QUEUE_ATTEMPTS = 6

export async function consumeWebhooks(
  batch: QueueBatch<WebhookJob | CamelWebhookJob>,
  env: Env,
): Promise<void> {
  await Promise.all(
    batch.messages.map(async (message) => {
      const job = normalizeJob(message.body)
      const sql = tenancyFor(env).db(job.workspace_id)
      const endpoint = await sql
        .prepare(
          `SELECT id, url, secret, status, consecutive_failures FROM webhook_endpoints
            WHERE workspace_id = ? AND id = ?`,
        )
        .bind(job.workspace_id, job.endpoint_id)
        .first<{
          id: string
          url: string
          secret: string
          status: string
          consecutive_failures: number
        }>()

      if (endpoint?.status !== 'enabled') {
        message.ack()
        return
      }

      // A replay keeps the event_id and takes a new delivery_id: the customer
      // can dedupe on the event and still tell the two attempts apart.
      const deliveryId = job.delivery_id ?? newId('delivery')
      const result = await deliver(endpoint.url, endpoint.secret, job, deliveryId)

      await recordAttempt(sql, job, deliveryId, message.attempts + 1, result)

      if (result.ok) {
        await sql
          .prepare(
            'UPDATE webhook_endpoints SET consecutive_failures = 0 WHERE workspace_id = ? AND id = ?',
          )
          .bind(job.workspace_id, endpoint.id)
          .run()
        message.ack()
        return
      }

      // Twenty consecutive failures is a handler that is gone, not one that is
      // flaky. Disabling stops us hammering a dead endpoint for days; the
      // dashboard shows why, and re-enabling clears the counter.
      const failures = endpoint.consecutive_failures + 1
      await sql
        .prepare(
          `UPDATE webhook_endpoints
              SET consecutive_failures = ?,
                  status = CASE WHEN ? >= 20 THEN 'disabled' ELSE status END,
                  disabled_at = CASE WHEN ? >= 20 THEN ? ELSE disabled_at END
            WHERE workspace_id = ? AND id = ?`,
        )
        .bind(failures, failures, failures, new Date().toISOString(), job.workspace_id, endpoint.id)
        .run()

      if (message.attempts < QUEUE_ATTEMPTS) {
        message.retry({ delaySeconds: Math.min(10 * 2 ** message.attempts, 3600) })
        return
      }

      const actor = env.WEBHOOK_ENDPOINT.get(
        doName('WebhookEndpoint', job.workspace_id, endpoint.id),
      )
      await actor.enqueueTail({ ...job, delivery_id: deliveryId })
      message.ack()
    }),
  )
}

interface DeliveryResult {
  ok: boolean
  status: number | null
  body: string | null
  durationMs: number
  error?: string
}

async function deliver(
  url: string,
  secret: string,
  job: WebhookJob,
  deliveryId: string,
): Promise<DeliveryResult> {
  const payload = JSON.stringify({ type: job.type, created_at: job.created_at, data: job.data })
  const { header } = await signWebhook(secret, payload)
  const startedAt = Date.now()
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mailysend-signature': header,
        'mailysend-event-id': job.event_id,
        'mailysend-delivery-id': deliveryId,
        'user-agent': 'MailySend-Webhook/1.0',
      },
      body: payload,
      // A handler that takes longer than this is a handler that will time out
      // under real load; failing fast keeps the queue moving.
      signal: AbortSignal.timeout(10_000),
    })
    // Only the first 4 KB of the response is kept. It is shown in the dashboard
    // to help a customer debug their handler, not archived.
    const body = (await response.text().catch(() => '')).slice(0, 4096)
    return { ok: response.ok, status: response.status, body, durationMs: Date.now() - startedAt }
  } catch (err) {
    return {
      ok: false,
      status: null,
      body: null,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function recordAttempt(
  sql: import('@mailysend/platform').Sql,
  job: WebhookJob,
  deliveryId: string,
  attempt: number,
  result: DeliveryResult,
): Promise<void> {
  await sql
    .prepare(
      `INSERT INTO webhook_deliveries
         (id, workspace_id, endpoint_id, event_id, event_type, attempt, status,
          response_status, response_body, duration_ms, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      deliveryId,
      job.workspace_id,
      job.endpoint_id,
      job.event_id,
      job.type,
      attempt,
      result.ok ? 'delivered' : 'failed',
      result.status,
      // A transport error has no response body, so the error text goes here —
      // it is what the dashboard needs to show, and an empty cell beside a
      // failed delivery helps nobody.
      result.body ?? (result.error ? `error: ${result.error}` : null),
      result.durationMs,
      new Date().toISOString(),
    )
    .run()
}
