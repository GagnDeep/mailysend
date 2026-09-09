import {
  apiError,
  BatchSendRequest,
  SendEmailRequest,
  UpdateEmailRequest,
} from '@mailysend/contracts'
import { doName, idLowerBound, stableBucket } from '@mailysend/core'
import { requireScope } from '../auth.ts'
import { acceptEmail } from '../send/accept.ts'
import {
  type App,
  createRouter,
  enforceRateLimit,
  json,
  page,
  parseLimit,
  withContext,
} from './base.ts'

/**
 * `/v1/emails` — the endpoint the whole product is judged on.
 *
 * The request/response shapes are Resend's exactly, so `import { Resend } from
 * 'resend'` with `RESEND_BASE_URL` pointed here works with nothing else
 * changed. Everything we add is additive and ignored by their SDK.
 */

const emails: App = createRouter()

emails.use('*', withContext('emails:send'))

emails.post('/', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'emails:send')
  const body = SendEmailRequest.parse(await c.req.json())
  const result = await acceptEmail(ctx, body, {
    idempotencyKey: c.req.header('idempotency-key') ?? null,
  })
  // Resend returns `{ id }`. The extra fields are ours; their SDK ignores them,
  // and `suppressed` is the difference between "we sent it" and "we sent it to
  // the three of five recipients who were not suppressed".
  return json(
    {
      id: result.id,
      created_at: result.created_at,
      ...(result.suppressed.length ? { suppressed: result.suppressed } : {}),
    },
    200,
  )
})

/**
 * `/v1/emails/batch` — up to 100 messages.
 *
 * Partial success by design: one malformed item does not reject the other 99,
 * and the response says which index failed. Rejecting the batch would force the
 * caller to diff arrays to find out what happened.
 */
emails.post('/batch', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'emails:send')
  const items = BatchSendRequest.parse(await c.req.json())
  const idempotencyKey = c.req.header('idempotency-key')

  const results = await Promise.all(
    items.map(async (item, index) => {
      try {
        const accepted = await acceptEmail(ctx, item, {
          // Deriving each item's key from the batch key keeps a retried batch
          // idempotent per item, which is the behaviour a caller expects when
          // they set one header for the whole call.
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:${index}` : null,
        })
        return { id: accepted.id }
      } catch (err) {
        const body =
          err instanceof Error && 'toBody' in err
            ? (err as { toBody(): { name: string; message: string } }).toBody()
            : null
        return {
          index,
          error: { name: body?.name ?? 'application_error', message: body?.message ?? String(err) },
        }
      }
    }),
  )
  return json({ data: results })
})

emails.get('/', async (c) => {
  const ctx = c.get('ctx')
  const limit = parseLimit(c.req.query('limit'))
  const cursor = c.req.query('cursor')
  const status = c.req.query('status')

  const rows = await ctx.sql
    .prepare(
      `SELECT id, from_address, to_addresses, subject, status, provider, provider_message_id,
              open_count, click_count, scheduled_at, sent_at, created_at
         FROM messages
        WHERE workspace_id = ? AND environment = ?
          ${cursor ? 'AND id < ?' : ''}
          ${status ? 'AND status = ?' : ''}
        ORDER BY id DESC LIMIT ?`,
    )
    .bind(
      ctx.workspace.id,
      ctx.actor.environment,
      ...(cursor ? [cursor] : []),
      ...(status ? [status] : []),
      limit + 1,
    )
    .all<MessageRow>()

  return json(page(rows.results.map(toEmail), limit))
})

emails.get('/:id', async (c) => {
  const ctx = c.get('ctx')
  const row = await ctx.sql
    .prepare(
      `SELECT id, from_address, to_addresses, cc_addresses, bcc_addresses, reply_to, subject,
              status, provider, provider_message_id, open_count, click_count, bounce_class,
              smtp_code, smtp_response, error_message, scheduled_at, sent_at, delivered_at, created_at
         FROM messages WHERE id = ? AND workspace_id = ?`,
    )
    .bind(c.req.param('id'), ctx.workspace.id)
    .first<MessageRow>()
  if (!row) throw apiError('not_found')

  const tags = await ctx.sql
    .prepare('SELECT name, value FROM message_tags WHERE workspace_id = ? AND message_id = ?')
    .bind(ctx.workspace.id, row.id)
    .all<{ name: string; value: string }>()

  return json({ ...toEmail(row), tags: tags.results })
})

/** `PATCH /v1/emails/:id` — reschedule. Only meaningful while still scheduled. */
emails.patch('/:id', async (c) => {
  const ctx = c.get('ctx')
  const { scheduled_at } = UpdateEmailRequest.parse(await c.req.json())
  const id = c.req.param('id')
  const { parseScheduledAt, MAX_SCHEDULE_MS } = await import('@mailysend/core')
  const parsed = parseScheduledAt(scheduled_at)
  if (!parsed) throw apiError('validation_error', { param: 'scheduled_at' })
  const delta = parsed.at.getTime() - Date.now()
  if (delta < 0) throw apiError('scheduling_in_past', { param: 'scheduled_at' })
  if (delta > MAX_SCHEDULE_MS) throw apiError('scheduling_too_far', { param: 'scheduled_at' })

  // The old due time is part of the shard's key, so the reschedule needs it.
  const previous = await ctx.sql
    .prepare(
      `SELECT scheduled_at FROM messages WHERE id = ? AND workspace_id = ? AND status = 'scheduled'`,
    )
    .bind(id, ctx.workspace.id)
    .first<{ scheduled_at: string }>()
  if (!previous?.scheduled_at) {
    throw apiError('not_found', {
      message: 'That message is not scheduled — it has already been queued or sent.',
    })
  }

  const res = await ctx.sql
    .prepare(
      `UPDATE messages SET scheduled_at = ? WHERE id = ? AND workspace_id = ? AND status = 'scheduled'`,
    )
    .bind(parsed.at.toISOString(), id, ctx.workspace.id)
    .run()
  if (res.meta.changes === 0) {
    throw apiError('not_found', {
      message: 'That message is not scheduled — it has already been queued or sent.',
    })
  }

  const stub = ctx.env.SCHEDULE_SHARD.get(
    doName('ScheduleShard', ctx.workspace.id, stableBucket(id, 8)),
  )
  await stub.reschedule(
    id,
    Date.parse(previous.scheduled_at),
    parsed.at.getTime(),
    ctx.workspace.id,
  )
  return json({ object: 'email', id, scheduled_at: parsed.at.toISOString() })
})

/** `DELETE /v1/emails/:id` — cancel a scheduled send. */
emails.delete('/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const scheduled = await ctx.sql
    .prepare(
      `SELECT scheduled_at FROM messages WHERE id = ? AND workspace_id = ? AND status = 'scheduled'`,
    )
    .bind(id, ctx.workspace.id)
    .first<{ scheduled_at: string }>()
  if (!scheduled?.scheduled_at) {
    throw apiError('not_found', {
      message:
        'Only a scheduled message can be canceled. This one has already been queued or sent.',
    })
  }

  const res = await ctx.sql
    .prepare(
      `UPDATE messages SET status = 'canceled', state_rank = 80
        WHERE id = ? AND workspace_id = ? AND status = 'scheduled'`,
    )
    .bind(id, ctx.workspace.id)
    .run()
  if (res.meta.changes === 0) {
    throw apiError('not_found', {
      message:
        'Only a scheduled message can be canceled. This one has already been queued or sent.',
    })
  }
  const stub = ctx.env.SCHEDULE_SHARD.get(
    doName('ScheduleShard', ctx.workspace.id, stableBucket(id, 8)),
  )
  await stub.cancel(id, Date.parse(scheduled.scheduled_at))
  return json({ object: 'email', id, status: 'canceled' })
})

/** The message timeline. Reads `message_events` when detail is on. */
emails.get('/:id/events', async (c) => {
  const ctx = c.get('ctx')
  if (!ctx.features.eventDetail) {
    throw apiError('not_implemented', {
      message:
        'Per-event detail is disabled on this deployment (EVENT_DETAIL=off). Timelines are reconstructed from the archive; use /v1/exports instead.',
    })
  }
  const rows = await ctx.sql
    .prepare(
      `SELECT event_id AS id, type, recipient, provider, occurred_at, bounce_class, smtp_code, smtp_response,
              user_agent, ip, link_url, audience_class
         FROM message_events WHERE workspace_id = ? AND message_id = ?
        ORDER BY occurred_at ASC, event_id ASC LIMIT 500`,
    )
    .bind(ctx.workspace.id, c.req.param('id'))
    .all()
  return json({ object: 'list', data: rows.results })
})

interface MessageRow {
  id: string
  from_address: string
  to_addresses: string
  cc_addresses?: string | null
  bcc_addresses?: string | null
  reply_to?: string | null
  subject: string
  status: string
  provider: string | null
  provider_message_id: string | null
  open_count: number
  click_count: number
  bounce_class?: string | null
  smtp_code?: string | null
  smtp_response?: string | null
  error_message?: string | null
  scheduled_at: string | null
  sent_at: string | null
  delivered_at?: string | null
  created_at: string
}

const parseList = (raw: string | null | undefined): string[] | null =>
  raw ? (JSON.parse(raw) as string[]) : null

const toEmail = (row: MessageRow) => ({
  object: 'email' as const,
  id: row.id,
  from: row.from_address,
  to: parseList(row.to_addresses) ?? [],
  cc: parseList(row.cc_addresses),
  bcc: parseList(row.bcc_addresses),
  reply_to: parseList(row.reply_to),
  subject: row.subject,
  // Resend calls this `last_event`; ours is the same vocabulary.
  last_event: row.status,
  created_at: row.created_at,
  scheduled_at: row.scheduled_at,
  sent_at: row.sent_at,
  delivered_at: row.delivered_at ?? null,
  provider: row.provider,
  provider_message_id: row.provider_message_id,
  opens: row.open_count,
  clicks: row.click_count,
  ...(row.bounce_class ? { bounce_class: row.bounce_class } : {}),
  ...(row.smtp_response ? { smtp_response: row.smtp_response } : {}),
  ...(row.error_message ? { error: row.error_message } : {}),
})

export { emails, enforceRateLimit, idLowerBound, type MessageRow, toEmail }
