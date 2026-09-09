import { apiError, CreateWebhookRequest, WebhookEventName } from '@mailysend/contracts'
import { base64url, doName, newId, signWebhook } from '@mailysend/core'
import { z } from 'zod'
import { requireRole, requireScope } from '../auth.ts'
import type { Ctx } from '../context.ts'
import { type App, createRouter, json, page, parseLimit, withContext } from './base.ts'

/**
 * `/v1/webhooks`.
 *
 * The signing secret is shown once at creation and never again — a secret that
 * can be re-read is a secret that leaks through a screenshot, a support ticket
 * or a compromised session, and re-reading it buys nothing that rotating it
 * does not. Deliveries keep their response status and body because "we sent it"
 * is not an answer anyone can debug; "your endpoint returned 502 with this
 * body" is.
 */

const webhooks: App = createRouter()

webhooks.use('*', withContext())

const UpdateWebhookRequest = z.object({
  url: z.string().url().optional(),
  events: z.array(WebhookEventName).min(1).max(40).optional(),
  enabled: z.boolean().optional(),
  description: z.string().max(200).optional(),
})

/** `whsec_` mirrors the convention every webhook-verifying library already documents. */
const generateSigningSecret = (): string => {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return `whsec_${base64url.encode(bytes)}`
}

webhooks.post('/', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'webhooks:write')
  requireRole(ctx.actor, 'developer')
  const body = CreateWebhookRequest.parse(await c.req.json())

  const id = newId('webhook')
  const now = new Date().toISOString()
  const secret = generateSigningSecret()

  await ctx.sql
    .prepare(
      `INSERT INTO webhook_endpoints (id, workspace_id, url, events, secret, status, description, created_at)
       VALUES (?, ?, ?, ?, ?, 'enabled', ?, ?)`,
    )
    .bind(
      id,
      ctx.workspace.id,
      body.url,
      JSON.stringify(body.events),
      secret,
      body.description ?? null,
      now,
    )
    .run()

  return json(
    {
      object: 'webhook',
      id,
      url: body.url,
      events: body.events,
      status: 'enabled',
      description: body.description ?? null,
      created_at: now,
      /** Present only here. Store it now; it cannot be retrieved later. */
      secret,
    },
    201,
  )
})

webhooks.get('/', async (c) => {
  const ctx = c.get('ctx')
  const limit = parseLimit(c.req.query('limit'))
  const cursor = c.req.query('cursor')

  const rows = await ctx.sql
    .prepare(
      `SELECT id, url, events, status, description, consecutive_failures, disabled_at, created_at
         FROM webhook_endpoints
        WHERE workspace_id = ? ${cursor ? 'AND id < ?' : ''}
        ORDER BY id DESC LIMIT ?`,
    )
    .bind(ctx.workspace.id, ...(cursor ? [cursor] : []), limit + 1)
    .all<EndpointRow>()

  return json(page(rows.results.map(toWebhook), limit))
})

webhooks.get('/:id', async (c) => {
  const ctx = c.get('ctx')
  const row = await loadEndpoint(ctx, c.req.param('id'))

  // The actor holds the retry tail; the D1 counter only moves when a delivery
  // finishes, so without this a customer sees "0 failures" for an endpoint with
  // six hours of queued retries behind it.
  const health = await ctx.env.WEBHOOK_ENDPOINT.get(
    doName('WebhookEndpoint', ctx.workspace.id, row.id),
  ).health()

  return json({
    ...toWebhook(row),
    pending_retries: health.pending,
    consecutive_failures: Math.max(row.consecutive_failures, health.consecutiveFailures),
  })
})

webhooks.patch('/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'webhooks:write')
  requireRole(ctx.actor, 'developer')
  const patch = UpdateWebhookRequest.parse(await c.req.json())
  const row = await loadEndpoint(ctx, c.req.param('id'))

  const columns: Record<string, unknown> = {}
  if (patch.url !== undefined) columns.url = patch.url
  if (patch.events !== undefined) columns.events = JSON.stringify(patch.events)
  if (patch.description !== undefined) columns.description = patch.description
  if (patch.enabled !== undefined) {
    columns.status = patch.enabled ? 'enabled' : 'disabled'
    columns.disabled_at = patch.enabled ? null : new Date().toISOString()
    // Re-enabling an endpoint the failure counter switched off has to clear the
    // counter, or it trips again on the first hiccup after the fix.
    if (patch.enabled) columns.consecutive_failures = 0
  }

  const keys = Object.keys(columns)
  if (keys.length === 0)
    throw apiError('validation_error', { message: 'No updatable fields supplied.' })

  await ctx.sql
    .prepare(
      `UPDATE webhook_endpoints SET ${keys.map((k) => `${k} = ?`).join(', ')}
        WHERE id = ? AND workspace_id = ?`,
    )
    .bind(...keys.map((k) => columns[k]), row.id, ctx.workspace.id)
    .run()

  return json(toWebhook(await loadEndpoint(ctx, row.id)))
})

webhooks.delete('/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'webhooks:write')
  requireRole(ctx.actor, 'developer')
  const row = await loadEndpoint(ctx, c.req.param('id'))

  await ctx.sql.batch([
    ctx.sql
      .prepare('DELETE FROM webhook_deliveries WHERE workspace_id = ? AND endpoint_id = ?')
      .bind(ctx.workspace.id, row.id),
    ctx.sql
      .prepare('DELETE FROM webhook_endpoints WHERE workspace_id = ? AND id = ?')
      .bind(ctx.workspace.id, row.id),
  ])

  return json({ object: 'webhook', id: row.id, deleted: true })
})

/** The attempt log. Response bodies are truncated at write time, not read time. */
webhooks.get('/:id/deliveries', async (c) => {
  const ctx = c.get('ctx')
  const row = await loadEndpoint(ctx, c.req.param('id'))
  const limit = parseLimit(c.req.query('limit'))
  const cursor = c.req.query('cursor')
  const status = c.req.query('status')

  const rows = await ctx.sql
    .prepare(
      `SELECT id, event_id, event_type, attempt, status, response_status, response_body,
              duration_ms, created_at
         FROM webhook_deliveries
        WHERE workspace_id = ? AND endpoint_id = ?
          ${cursor ? 'AND id < ?' : ''}
          ${status ? 'AND status = ?' : ''}
        ORDER BY id DESC LIMIT ?`,
    )
    .bind(
      ctx.workspace.id,
      row.id,
      ...(cursor ? [cursor] : []),
      ...(status ? [status] : []),
      limit + 1,
    )
    .all<DeliveryRow>()

  return json(page(rows.results.map(toDelivery), limit))
})

/**
 * Replay.
 *
 * A new `delivery_id` and the *same* `event_id`: the delivery is a new attempt
 * to be logged separately, but the event is the same event, and a consumer that
 * deduplicates on `event_id` — which is what we tell them to do — must see the
 * replay as the thing it already knows about rather than as a second incident.
 */
webhooks.post('/:id/deliveries/:delivery_id/replay', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'webhooks:write')
  const row = await loadEndpoint(ctx, c.req.param('id'))

  const original = await ctx.sql
    .prepare(
      `SELECT id, event_id, event_type, attempt FROM webhook_deliveries
        WHERE id = ? AND endpoint_id = ? AND workspace_id = ?`,
    )
    .bind(c.req.param('delivery_id'), row.id, ctx.workspace.id)
    .first<{ id: string; event_id: string; event_type: string; attempt: number }>()
  if (!original) throw apiError('not_found')

  const payload = await rebuildPayload(ctx, original.event_id, original.event_type)
  if (!payload) {
    throw apiError('not_found', {
      message:
        'The event behind that delivery is no longer in the detail store, so it cannot be replayed. Use /v1/exports to retrieve it from the archive.',
    })
  }

  const deliveryId = newId('delivery')
  const now = new Date().toISOString()
  await ctx.sql
    .prepare(
      `INSERT INTO webhook_deliveries (id, workspace_id, endpoint_id, event_id, event_type,
                                       attempt, status, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 'pending', ?)`,
    )
    .bind(deliveryId, ctx.workspace.id, row.id, original.event_id, original.event_type, now)
    .run()

  await ctx.env.WEBHOOKS_QUEUE.send({
    workspaceId: ctx.workspace.id,
    endpointId: row.id,
    deliveryId,
    eventId: original.event_id,
    eventType: original.event_type,
    body: JSON.stringify(payload),
    attempt: 1,
    replayOf: original.id,
  })

  return json({
    object: 'webhook_delivery',
    id: deliveryId,
    endpoint_id: row.id,
    event_id: original.event_id,
    event_type: original.event_type,
    status: 'pending',
    replay_of: original.id,
    created_at: now,
  })
})

/**
 * A synthetic `email.delivered`, signed exactly the way a real one is.
 *
 * It is delivered inline rather than through the queue, because the only reason
 * to press this button is to see the answer — a customer debugging a signature
 * mismatch needs the status code and body in the response, not a row that
 * appears somewhere a few seconds later.
 */
webhooks.post('/:id/test', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'webhooks:write')
  const row = await loadEndpoint(ctx, c.req.param('id'))

  const eventId = newId('event')
  const deliveryId = newId('delivery')
  const now = new Date().toISOString()
  const payload = {
    type: 'email.delivered',
    event_id: eventId,
    created_at: now,
    /** Flagged so a handler wired to production data can ignore it. */
    test: true,
    data: {
      object: 'email',
      email_id: newId('email'),
      from: `test@${new URL(ctx.publicUrl).hostname}`,
      to: ['delivered@resend.dev'],
      subject: 'MailySend webhook test',
      created_at: now,
      delivered_at: now,
    },
  }

  const serialized = JSON.stringify(payload)
  const signature = await signWebhook(row.secret, serialized)

  const startedAt = Date.now()
  let responseStatus: number | null = null
  let responseBody: string | null = null
  try {
    const response = await fetch(row.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mailysend-signature': signature.header,
        'user-agent': 'MailySend/1.0 (+https://mailysend.com/docs/webhooks)',
      },
      body: serialized,
      signal: AbortSignal.timeout(10_000),
    })
    responseStatus = response.status
    responseBody = (await response.text()).slice(0, 2000)
  } catch (err) {
    responseBody = err instanceof Error ? err.message : String(err)
  }
  const durationMs = Date.now() - startedAt
  const ok = responseStatus !== null && responseStatus >= 200 && responseStatus < 300

  // Logged like any other delivery: a test that fails should be visible in the
  // same place the customer already looks for failures.
  await ctx.sql
    .prepare(
      `INSERT INTO webhook_deliveries (id, workspace_id, endpoint_id, event_id, event_type, attempt,
                                       status, response_status, response_body, duration_ms, created_at)
       VALUES (?, ?, ?, ?, 'email.delivered', 1, ?, ?, ?, ?, ?)`,
    )
    .bind(
      deliveryId,
      ctx.workspace.id,
      row.id,
      eventId,
      ok ? 'delivered' : 'failed',
      responseStatus,
      responseBody,
      durationMs,
      now,
    )
    .run()

  return json({
    object: 'webhook_delivery',
    id: deliveryId,
    endpoint_id: row.id,
    event_id: eventId,
    event_type: 'email.delivered',
    status: ok ? 'delivered' : 'failed',
    response_status: responseStatus,
    response_body: responseBody,
    duration_ms: durationMs,
    /** Echoed so the customer can check their verification code against it. */
    signature: signature.header,
    payload,
    created_at: now,
  })
})

/** Rebuilds a webhook body from the stored event, so a replay carries real data. */
async function rebuildPayload(
  ctx: Ctx,
  eventId: string,
  eventType: string,
): Promise<Record<string, unknown> | null> {
  const event = await ctx.sql
    .prepare(
      `SELECT event_id, type, message_id, recipient, occurred_at, provider, link_url,
              bounce_class, smtp_code, smtp_response, ip, user_agent
         FROM message_events WHERE event_id = ? AND workspace_id = ?`,
    )
    .bind(eventId, ctx.workspace.id)
    .first<EventRow>()
  if (!event) return null

  return {
    type: event.type ?? eventType,
    event_id: event.event_id,
    created_at: event.occurred_at,
    data: {
      object: 'email',
      email_id: event.message_id,
      to: [event.recipient],
      provider: event.provider,
      ...(event.link_url ? { link: event.link_url } : {}),
      ...(event.bounce_class ? { bounce_class: event.bounce_class } : {}),
      ...(event.smtp_code ? { smtp_code: event.smtp_code } : {}),
      ...(event.smtp_response ? { smtp_response: event.smtp_response } : {}),
      ...(event.ip ? { ip: event.ip } : {}),
      ...(event.user_agent ? { user_agent: event.user_agent } : {}),
    },
  }
}

interface EventRow {
  event_id: string
  type: string
  message_id: string | null
  recipient: string
  occurred_at: string
  provider: string | null
  link_url: string | null
  bounce_class: string | null
  smtp_code: string | null
  smtp_response: string | null
  ip: string | null
  user_agent: string | null
}

interface EndpointRow {
  id: string
  url: string
  events: string
  status: string
  description: string | null
  consecutive_failures: number
  disabled_at: string | null
  created_at: string
}

interface DeliveryRow {
  id: string
  event_id: string
  event_type: string
  attempt: number
  status: string
  response_status: number | null
  response_body: string | null
  duration_ms: number | null
  created_at: string
}

/** Selects `secret` only where it is needed to sign; never where it is serialized. */
async function loadEndpoint(ctx: Ctx, id: string): Promise<EndpointRow & { secret: string }> {
  const row = await ctx.sql
    .prepare(
      `SELECT id, url, events, secret, status, description, consecutive_failures, disabled_at, created_at
         FROM webhook_endpoints WHERE id = ? AND workspace_id = ?`,
    )
    .bind(id, ctx.workspace.id)
    .first<EndpointRow & { secret: string }>()
  if (!row) throw apiError('not_found')
  return row
}

const toWebhook = (row: EndpointRow) => ({
  object: 'webhook' as const,
  id: row.id,
  url: row.url,
  events: JSON.parse(row.events) as string[],
  status: row.status,
  description: row.description,
  consecutive_failures: row.consecutive_failures,
  disabled_at: row.disabled_at,
  created_at: row.created_at,
})

const toDelivery = (row: DeliveryRow) => ({
  object: 'webhook_delivery' as const,
  id: row.id,
  event_id: row.event_id,
  event_type: row.event_type,
  attempt: row.attempt,
  status: row.status,
  response_status: row.response_status,
  response_body: row.response_body,
  duration_ms: row.duration_ms,
  created_at: row.created_at,
})

export { webhooks }
