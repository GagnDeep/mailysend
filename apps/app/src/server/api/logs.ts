import { apiError } from '@mailysend/contracts'
import { idLowerBound, idUpperBound, newId, r2Key } from '@mailysend/core'
import type { Ctx } from '../context.ts'
import { type App, createRouter, json, page, parseLimit, withContext } from './base.ts'

/**
 * `/v1/logs` — the dashboard's message log.
 *
 * `/v1/emails` is the Resend-compatible resource; this is the operator's view
 * of the same rows, with the filters an incident actually needs (one tag, one
 * provider, one recipient, one hour) and a detail payload that answers the only
 * question a log page exists to answer: *what exactly did we send, and what did
 * the receiving server say back?*
 */

const logs: App = createRouter()

logs.use('*', withContext())

interface LogRow {
  id: string
  from_address: string
  to_addresses: string
  subject: string
  status: string
  provider: string | null
  provider_message_id: string | null
  domain_id: string | null
  broadcast_id: string | null
  automation_id: string | null
  contact_id: string | null
  open_count: number
  click_count: number
  bounce_class: string | null
  smtp_code: string | null
  smtp_response: string | null
  error_message: string | null
  size_bytes: number | null
  attempts: number
  scheduled_at: string | null
  sent_at: string | null
  delivered_at: string | null
  created_at: string
}

interface Filters {
  where: string
  args: unknown[]
}

/**
 * Filters compile to conditions on `messages`, with tags as an EXISTS against
 * `message_tags` rather than a JOIN — a JOIN would multiply rows by tag count
 * and quietly break both the page size and the cursor.
 */
function buildFilters(ctx: Ctx, q: URLSearchParams): Filters {
  const clauses = ['workspace_id = ?', 'environment = ?']
  const args: unknown[] = [ctx.workspace.id, ctx.actor.environment]

  const status = q.get('status')
  if (status) {
    const list = status
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    clauses.push(`status IN (${list.map(() => '?').join(', ')})`)
    args.push(...list)
  }

  const domainId = q.get('domain_id')
  if (domainId) {
    clauses.push('domain_id = ?')
    args.push(domainId)
  }

  const provider = q.get('provider')
  if (provider) {
    clauses.push('provider = ?')
    args.push(provider)
  }

  const broadcastId = q.get('broadcast_id')
  if (broadcastId) {
    clauses.push('broadcast_id = ?')
    args.push(broadcastId)
  }

  const automationId = q.get('automation_id')
  if (automationId) {
    clauses.push('automation_id = ?')
    args.push(automationId)
  }

  const recipient = q.get('recipient')
  if (recipient) {
    // Recipients live as a JSON array in one column; the quotes in the pattern
    // stop `bob@x.com` from matching `bobby@x.com`.
    clauses.push('to_addresses LIKE ?')
    args.push(`%"${recipient.toLowerCase()}"%`)
  }

  const tagName = q.get('tag_name') ?? q.get('tag')
  const tagValue = q.get('tag_value')
  if (tagName) {
    clauses.push(
      `EXISTS (SELECT 1 FROM message_tags t
                WHERE t.workspace_id = messages.workspace_id AND t.message_id = messages.id
                  AND t.name = ?${tagValue ? ' AND t.value = ?' : ''})`,
    )
    args.push(tagName)
    if (tagValue) args.push(tagValue)
  }

  // The id is a ULID, so a time range is a range scan on the primary key and
  // needs no created_at index.
  const from = q.get('from')
  if (from) {
    const at = Date.parse(from)
    if (Number.isNaN(at)) throw apiError('validation_error', { param: 'from' })
    clauses.push('id >= ?')
    args.push(idLowerBound('email', at))
  }
  const to = q.get('to')
  if (to) {
    const at = Date.parse(to)
    if (Number.isNaN(at)) throw apiError('validation_error', { param: 'to' })
    clauses.push('id <= ?')
    args.push(idUpperBound('email', at))
  }

  const search = q.get('search') ?? q.get('q')
  if (search) {
    clauses.push('(subject LIKE ? OR to_addresses LIKE ? OR from_address LIKE ?)')
    const pattern = `%${search}%`
    args.push(pattern, pattern, pattern)
  }

  return { where: clauses.join(' AND '), args }
}

const parseList = (raw: string | null): string[] => (raw ? (JSON.parse(raw) as string[]) : [])

const toLog = (row: LogRow) => ({
  object: 'log' as const,
  id: row.id,
  from: row.from_address,
  to: parseList(row.to_addresses),
  subject: row.subject,
  status: row.status,
  provider: row.provider,
  provider_message_id: row.provider_message_id,
  domain_id: row.domain_id,
  broadcast_id: row.broadcast_id,
  automation_id: row.automation_id,
  contact_id: row.contact_id,
  opens: row.open_count,
  clicks: row.click_count,
  bounce_class: row.bounce_class,
  smtp_code: row.smtp_code,
  smtp_response: row.smtp_response,
  error: row.error_message,
  size_bytes: row.size_bytes,
  attempts: row.attempts,
  scheduled_at: row.scheduled_at,
  sent_at: row.sent_at,
  delivered_at: row.delivered_at,
  created_at: row.created_at,
})

const COLUMNS = `id, from_address, to_addresses, subject, status, provider, provider_message_id,
                 domain_id, broadcast_id, automation_id, contact_id, open_count, click_count,
                 bounce_class, smtp_code, smtp_response, error_message, size_bytes, attempts,
                 scheduled_at, sent_at, delivered_at, created_at`

logs.get('/', async (c) => {
  const ctx = c.get('ctx')
  const q = new URL(c.req.url).searchParams
  const limit = parseLimit(q.get('limit') ?? undefined)
  const cursor = q.get('cursor')
  const filters = buildFilters(ctx, q)

  const rows = await ctx.sql
    .prepare(
      `SELECT ${COLUMNS} FROM messages
        WHERE ${filters.where} ${cursor ? 'AND id < ?' : ''}
        ORDER BY id DESC LIMIT ?`,
    )
    .bind(...filters.args, ...(cursor ? [cursor] : []), limit + 1)
    .all<LogRow>()

  return json(page(rows.results.map(toLog), limit))
})

/**
 * `GET /v1/logs/export` — hands the filter set to the export worker.
 *
 * Exports are asynchronous because the honest range for this endpoint is
 * millions of rows; streaming them through a request that a browser may
 * abandon would produce a truncated CSV with no error anywhere.
 */
logs.get('/export', async (c) => {
  const ctx = c.get('ctx')
  const q = new URL(c.req.url).searchParams
  const format = q.get('format') ?? 'csv'
  if (format !== 'csv' && format !== 'ndjson') {
    throw apiError('validation_error', {
      message: 'format must be `csv` or `ndjson`.',
      param: 'format',
    })
  }
  // Built (and thrown away) here so a bad filter is a 422 now rather than a
  // failed job the user only discovers when the email never arrives.
  buildFilters(ctx, q)

  const id = newId('event')
  await ctx.env.EXPORT_QUEUE.send({
    type: 'logs.export',
    export_id: id,
    workspace_id: ctx.workspace.id,
    environment: ctx.actor.environment,
    requested_by: ctx.actor.userId ?? ctx.actor.apiKeyId ?? null,
    format,
    filters: Object.fromEntries(q.entries()),
    key_prefix: r2Key.export(ctx.workspace.id, id, ''),
    created_at: new Date().toISOString(),
  })

  return json({ object: 'export', id, status: 'queued', format }, 202)
})

/** Everything the log drawer shows, in one round trip. */
logs.get('/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')

  const row = await ctx.sql
    .prepare(`SELECT ${COLUMNS} FROM messages WHERE id = ? AND workspace_id = ?`)
    .bind(id, ctx.workspace.id)
    .first<LogRow>()
  if (!row) throw apiError('not_found')

  const [tags, events, links] = await Promise.all([
    ctx.sql
      .prepare('SELECT name, value FROM message_tags WHERE workspace_id = ? AND message_id = ?')
      .bind(ctx.workspace.id, id)
      .all<{ name: string; value: string }>(),
    ctx.features.eventDetail
      ? ctx.sql
          .prepare(
            `SELECT event_id, type, recipient, provider, occurred_at, bounce_class, smtp_code,
                    smtp_response, ip, user_agent, geo_country, link_url, audience_class
               FROM message_events WHERE workspace_id = ? AND message_id = ?
              ORDER BY occurred_at ASC, event_id ASC LIMIT 500`,
          )
          .bind(ctx.workspace.id, id)
          .all<EventRow>()
      : Promise.resolve({ results: [] as EventRow[] }),
    ctx.sql
      .prepare(
        'SELECT id, url, click_count, unique_click_count FROM message_links WHERE workspace_id = ? AND message_id = ?',
      )
      .bind(ctx.workspace.id, id)
      .all<{ id: string; url: string; click_count: number; unique_click_count: number }>(),
  ])

  const eventIds = events.results.map((e) => e.event_id)
  const deliveries = eventIds.length
    ? await ctx.sql
        .prepare(
          // The endpoint's URL is joined in because the drawer's whole job is to
          // say *where* a webhook went; an endpoint id is not an answer to that.
          `SELECT d.id, d.endpoint_id, e.url, d.event_id, d.event_type, d.attempt, d.status,
                  d.response_status, d.response_body, d.duration_ms, d.created_at
             FROM webhook_deliveries d
             LEFT JOIN webhook_endpoints e
               ON e.id = d.endpoint_id AND e.workspace_id = d.workspace_id
            WHERE d.workspace_id = ? AND d.event_id IN (${eventIds.map(() => '?').join(', ')})
            ORDER BY d.created_at ASC LIMIT 200`,
        )
        .bind(ctx.workspace.id, ...eventIds)
        .all()
    : { results: [] as unknown[] }

  return json({
    ...toLog(row),
    tags: tags.results,
    events: events.results,
    /**
     * The SMTP conversation, assembled from the message row and every event
     * that carried a response. A `550 5.1.1` in the recipient's own words is
     * the difference between "it bounced" and knowing why.
     */
    smtp: [
      ...(row.smtp_code || row.smtp_response
        ? [
            {
              at: row.sent_at ?? row.created_at,
              code: row.smtp_code,
              response: row.smtp_response,
              source: 'message',
            },
          ]
        : []),
      ...events.results
        .filter((e) => e.smtp_code || e.smtp_response)
        .map((e) => ({
          at: e.occurred_at,
          code: e.smtp_code,
          response: e.smtp_response,
          source: e.type,
        })),
    ],
    links: links.results,
    webhook_deliveries: deliveries.results,
    ...(await spooledEnvelope(ctx, id)),
    event_detail: ctx.features.eventDetail,
  })
})

interface EventRow {
  event_id: string
  type: string
  recipient: string
  provider: string | null
  occurred_at: string
  bounce_class: string | null
  smtp_code: string | null
  smtp_response: string | null
  ip: string | null
  user_agent: string | null
  geo_country: string | null
  link_url: string | null
  audience_class: string | null
}

/**
 * The spool object expires at seven days by lifecycle rule, so its absence is
 * normal for older mail and is reported as such rather than as an error.
 */
async function spooledEnvelope(
  ctx: Ctx,
  id: string,
): Promise<{ raw: unknown; raw_key: string; raw_available: boolean }> {
  const key = r2Key.spool(ctx.workspace.id, id)
  const object = await ctx.blob.get(key).catch(() => null)
  if (!object) return { raw: null, raw_key: key, raw_available: false }
  const body = await object.text()
  let raw: unknown = body
  try {
    raw = JSON.parse(body)
  } catch {
    // A spool object that is not JSON is still the truth about what we sent.
  }
  return { raw, raw_key: key, raw_available: true }
}

export { logs }
