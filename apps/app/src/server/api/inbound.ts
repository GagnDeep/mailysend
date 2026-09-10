import { apiError, SendEmailRequest } from '@mailysend/contracts'
import { newId } from '@mailysend/core'
import { z } from 'zod'
import { requireRole, requireScope } from '../auth.ts'
import type { Ctx } from '../context.ts'
import { acceptEmail } from '../send/accept.ts'
import { type App, createRouter, json, page, parseLimit, withContext } from './base.ts'

/**
 * `/v1/inbound` — received mail, as the public API has always described it.
 *
 * This is now a view over the conversation model in `mail_threads` /
 * `mail_messages` rather than a second implementation. It used to read
 * `inbound_threads`, a table nothing has ever written, and filter every result
 * against it — so the endpoint was structurally incapable of returning a row,
 * and both the dashboard and the SDK saw an inbox that was permanently empty.
 *
 * The shapes are unchanged, because they are documented and an SDK depends on
 * them. `/v1/mail` is the richer surface the dashboard uses.
 */

const inbound: App = createRouter()

inbound.use('*', withContext())

interface MailboxRow {
  id: string
  address: string
  name: string | null
  forward_webhook_id: string | null
  agent_enabled: number
  created_at: string
}

interface ThreadRow {
  id: string
  mailbox_id: string | null
  subject: string
  participants: string
  message_count: number
  unread_count: number
  last_message_at: string
  created_at: string
}

interface MessageRow {
  id: string
  thread_id: string
  mailbox_id: string | null
  message_id_header: string | null
  in_reply_to: string | null
  from_address: string
  to_addresses: string
  subject: string
  snippet: string
  body_key: string | null
  raw_key: string | null
  spf: string | null
  dkim: string | null
  dmarc: string | null
  spam_score: number | null
  parse_status: string
  matched_by: string | null
  at: string
}

const toMailbox = (row: MailboxRow) => ({
  object: 'inbound_mailbox' as const,
  id: row.id,
  address: row.address,
  name: row.name,
  forward_webhook_id: row.forward_webhook_id,
  agent_enabled: Boolean(row.agent_enabled),
  created_at: row.created_at,
})

const parseJsonList = (raw: string | null): string[] => {
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? (value as string[]) : []
  } catch {
    // Participants written before the column was JSON, or by a different tool.
    return raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  }
}

const toThread = (row: ThreadRow) => ({
  object: 'inbound_thread' as const,
  id: row.id,
  mailbox_id: row.mailbox_id,
  subject: row.subject,
  participants: parseJsonList(row.participants),
  message_count: row.message_count,
  unread: row.unread_count > 0,
  last_message_at: row.last_message_at,
})

// ---------------------------------------------------------------------------
// Mailboxes
// ---------------------------------------------------------------------------

inbound.get('/mailboxes', async (c) => {
  const ctx = c.get('ctx')
  const rows = await ctx.sql
    .prepare(
      `SELECT id, address, name, forward_webhook_id, agent_enabled, created_at
         FROM inbound_mailboxes WHERE workspace_id = ? ORDER BY id DESC LIMIT 200`,
    )
    .bind(ctx.workspace.id)
    .all<MailboxRow>()
  return json({
    object: 'list',
    data: rows.results.map(toMailbox),
    has_more: false,
    next_cursor: null,
  })
})

inbound.post('/mailboxes', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'inbound:write')
  requireRole(ctx.actor, 'developer')
  const body = z
    .object({
      address: z.string().min(3).max(320),
      name: z.string().max(120).optional(),
      forward_webhook_id: z.string().max(64).optional(),
      agent_enabled: z.boolean().optional(),
    })
    .parse(await c.req.json())

  const address = body.address.trim().toLowerCase()
  const [local, domain, ...rest] = address.split('@')
  if (!local || !domain || rest.length > 0 || !/^[^\s@]+\.[^\s@]+$/.test(domain)) {
    throw apiError('validation_error', {
      message: 'A mailbox is one whole address — a local part, an @, and a domain.',
      param: 'address',
    })
  }

  // The domain has to be one this workspace owns. Without this check the
  // endpoint accepted any domain at all, and a mailbox on somebody else's
  // domain is a row that can never receive anything and, worse, appeared in the
  // From picker as a sendable identity.
  const owned = await ctx.sql
    .prepare('SELECT id, status FROM domains WHERE workspace_id = ? AND name = ?')
    .bind(ctx.workspace.id, domain)
    .first<{ id: string; status: string }>()
  if (!owned) {
    throw apiError('validation_error', {
      message: `${domain} is not a domain in this workspace. Add it under Domains first — a mailbox can only exist on a domain you control.`,
      param: 'address',
    })
  }

  const existing = await ctx.sql
    .prepare('SELECT id FROM inbound_mailboxes WHERE workspace_id = ? AND address = ?')
    .bind(ctx.workspace.id, address)
    .first<{ id: string }>()
  if (existing) {
    throw apiError('validation_error', {
      message: 'That address is already a mailbox.',
      param: 'address',
    })
  }

  const id = newId('inbound')
  const now = new Date().toISOString()
  await ctx.sql
    .prepare(
      `INSERT INTO inbound_mailboxes
         (id, workspace_id, address, name, forward_webhook_id, agent_enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      ctx.workspace.id,
      address,
      body.name ?? null,
      body.forward_webhook_id ?? null,
      body.agent_enabled ? 1 : 0,
      now,
    )
    .run()

  return json({
    object: 'inbound_mailbox',
    id,
    address,
    name: body.name ?? null,
    forward_webhook_id: body.forward_webhook_id ?? null,
    agent_enabled: Boolean(body.agent_enabled),
    created_at: now,
    domain_status: owned.status,
    note:
      owned.status === 'verified'
        ? "Mail reaches this address once the domain's MX records point at MailySend."
        : `${domain} is not verified yet, so nothing will arrive here until it is.`,
  })
})

inbound.patch('/mailboxes/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'inbound:write')
  requireRole(ctx.actor, 'developer')
  const body = z
    .object({
      name: z.string().max(120).nullable().optional(),
      forward_webhook_id: z.string().max(64).nullable().optional(),
      agent_enabled: z.boolean().optional(),
    })
    .parse(await c.req.json())

  const sets: string[] = []
  const params: unknown[] = []
  if (body.name !== undefined) {
    sets.push('name = ?')
    params.push(body.name)
  }
  if (body.forward_webhook_id !== undefined) {
    sets.push('forward_webhook_id = ?')
    params.push(body.forward_webhook_id)
  }
  if (body.agent_enabled !== undefined) {
    sets.push('agent_enabled = ?')
    params.push(body.agent_enabled ? 1 : 0)
  }
  if (sets.length === 0) throw apiError('validation_error', { message: 'Nothing to change.' })

  const res = await ctx.sql
    .prepare(`UPDATE inbound_mailboxes SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`)
    .bind(...params, c.req.param('id'), ctx.workspace.id)
    .run()
  if (res.meta.changes === 0) throw apiError('not_found')

  const row = await ctx.sql
    .prepare(
      `SELECT id, address, name, forward_webhook_id, agent_enabled, created_at
         FROM inbound_mailboxes WHERE id = ? AND workspace_id = ?`,
    )
    .bind(c.req.param('id'), ctx.workspace.id)
    .first<MailboxRow>()
  return json(toMailbox(row!))
})

inbound.delete('/mailboxes/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'inbound:write')
  requireRole(ctx.actor, 'developer')
  const id = c.req.param('id')
  const res = await ctx.sql
    .prepare('DELETE FROM inbound_mailboxes WHERE id = ? AND workspace_id = ?')
    .bind(id, ctx.workspace.id)
    .run()
  if (res.meta.changes === 0) throw apiError('not_found')
  // Threads and their bodies are kept: deleting a route must not destroy mail
  // the customer has already received.
  return json({ object: 'inbound_mailbox', id, deleted: true })
})

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

inbound.get('/threads', async (c) => {
  const ctx = c.get('ctx')
  const limit = parseLimit(c.req.query('limit'))
  const before = c.req.query('cursor') ?? c.req.query('before')
  const unreadOnly = c.req.query('unread') === 'true'
  const mailboxId = c.req.query('mailbox_id')

  const where = ['workspace_id = ?', 'environment = ?', "last_direction = 'in'"]
  const params: unknown[] = [ctx.workspace.id, ctx.actor.environment]
  if (mailboxId) {
    where.push('mailbox_id = ?')
    params.push(mailboxId)
  }
  if (unreadOnly) where.push('unread_count > 0')
  if (before) {
    where.push('last_message_at < ?')
    params.push(before)
  }

  const rows = await ctx.sql
    .prepare(
      `SELECT id, mailbox_id, subject, participants, message_count, unread_count,
              last_message_at, created_at
         FROM mail_threads WHERE ${where.join(' AND ')}
        ORDER BY last_message_at DESC LIMIT ?`,
    )
    .bind(...params, limit + 1)
    .all<ThreadRow>()

  const paged = page(rows.results.map(toThread), limit)
  return json({
    ...paged,
    // The list pages on time, not on the id, so the cursor is a timestamp.
    next_cursor: paged.has_more ? (paged.data.at(-1)?.last_message_at ?? null) : null,
  })
})

inbound.get('/threads/:id', async (c) => {
  const ctx = c.get('ctx')
  const thread = await loadThread(ctx, c.req.param('id'))
  const rows = await listMessages(ctx, thread.id)
  const messages = await Promise.all(rows.map((row) => withBody(ctx, row)))
  return json({ ...toThread(thread), messages })
})

/** The route the dashboard has always called and that has never existed. */
inbound.get('/threads/:id/messages', async (c) => {
  const ctx = c.get('ctx')
  const thread = await loadThread(ctx, c.req.param('id'))
  const rows = await listMessages(ctx, thread.id)
  const data = await Promise.all(rows.map((row) => withBody(ctx, row)))
  return json({ object: 'list', data, has_more: false, next_cursor: null })
})

/** Likewise: the read/unread toggle the dashboard has always sent. */
inbound.patch('/threads/:id', async (c) => {
  const ctx = c.get('ctx')
  const body = z.object({ unread: z.boolean() }).parse(await c.req.json())
  const thread = await loadThread(ctx, c.req.param('id'))
  await ctx.sql
    .prepare('UPDATE mail_threads SET unread_count = ? WHERE id = ? AND workspace_id = ?')
    .bind(body.unread ? 1 : 0, thread.id, ctx.workspace.id)
    .run()
  await ctx.sql
    .prepare('UPDATE mail_messages SET unread = ? WHERE workspace_id = ? AND thread_id = ?')
    .bind(body.unread ? 1 : 0, ctx.workspace.id, thread.id)
    .run()
  return json({ ...toThread({ ...thread, unread_count: body.unread ? 1 : 0 }) })
})

inbound.get('/messages/:id', async (c) => {
  const ctx = c.get('ctx')
  return json(await withBody(ctx, await loadMessage(ctx, c.req.param('id'))))
})

/** The original MIME, byte for byte. The only thing that settles an argument about a header. */
inbound.get('/messages/:id/raw', async (c) => {
  const ctx = c.get('ctx')
  const row = await loadMessage(ctx, c.req.param('id'))
  const object = row.raw_key ? await ctx.blob.get(row.raw_key) : null
  if (!object) {
    throw apiError('not_found', { message: 'The raw message is no longer in storage.' })
  }
  return new Response(await object.text(), {
    headers: {
      'content-type': 'message/rfc822',
      'content-disposition': `attachment; filename="${row.id}.eml"`,
    },
  })
})

/**
 * Reply.
 *
 * The reply goes out through the ordinary send path — same suppression checks,
 * same domain governor, same log row — and carries `In-Reply-To` and
 * `References` so the recipient's client files it in the conversation it
 * belongs to rather than starting a new one.
 */
inbound.post('/threads/:id/reply', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'emails:send')
  const body = z
    .object({
      from: z.string().min(3).max(320).optional(),
      to: z.array(z.string().min(3).max(320)).min(1).max(50).optional(),
      subject: z.string().max(998).optional(),
      html: z.string().max(2_000_000).optional(),
      text: z.string().max(2_000_000).optional(),
    })
    .parse(await c.req.json())
  if (!body.html && !body.text) {
    throw apiError('no_content', { param: 'html' })
  }

  const thread = await loadThread(ctx, c.req.param('id'))
  const rows = await listMessages(ctx, thread.id)
  if (rows.length === 0) throw apiError('not_found')

  const last = rows.at(-1)!
  const references = rows
    .map((row) => row.message_id_header)
    .filter((value): value is string => Boolean(value))

  const headers: Record<string, string> = {}
  if (last.message_id_header) headers['In-Reply-To'] = last.message_id_header
  // References carries the whole chain; clients thread on it when In-Reply-To
  // has been rewritten by an intermediary, which happens constantly.
  if (references.length) headers.References = references.join(' ')

  // The address the message arrived at is the address the reply comes from,
  // unless the caller says otherwise. Guessing anything else sends a reply
  // from a mailbox the recipient has never seen.
  const from = body.from ?? (await defaultFrom(ctx, thread.mailbox_id))
  if (!from) {
    throw apiError('validation_error', {
      message: '`from` is required: this conversation has no mailbox to reply from.',
      param: 'from',
    })
  }

  const subject =
    body.subject ?? (/^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`)
  const request = SendEmailRequest.parse({
    from,
    to: body.to ?? [last.from_address],
    subject: subject || '(no subject)',
    html: body.html,
    text: body.text,
    headers,
  })
  const accepted = await acceptEmail(ctx, request)

  return json({
    object: 'inbound_reply',
    thread_id: thread.id,
    id: accepted.id,
    in_reply_to: last.message_id_header,
    references,
    created_at: accepted.created_at,
  })
})

inbound.get('/search', async (c) => {
  const ctx = c.get('ctx')
  const query = c.req.query('q')
  if (!query) throw apiError('validation_error', { message: '`q` is required.', param: 'q' })
  const limit = parseLimit(c.req.query('limit'), 20, 50)

  // FTS5 treats several punctuation characters as operators; quoting the whole
  // query makes user input a literal phrase rather than a syntax error.
  const safe = `"${query.replace(/"/g, '')}"`
  const rows = await ctx.sql
    .prepare(
      `SELECT m.id, m.thread_id, m.mailbox_id, m.from_address, m.subject, m.snippet, m.at
         FROM mail_search s
         JOIN mail_messages m ON m.id = s.message_id AND m.workspace_id = s.workspace_id
        WHERE s.workspace_id = ? AND s.environment = ? AND mail_search MATCH ?
        ORDER BY rank LIMIT ?`,
    )
    .bind(ctx.workspace.id, ctx.actor.environment, safe, limit + 1)
    .all<{
      id: string
      thread_id: string
      mailbox_id: string | null
      from_address: string
      subject: string
      snippet: string
      at: string
    }>()

  const hasMore = rows.results.length > limit
  return json({
    object: 'list',
    data: (hasMore ? rows.results.slice(0, limit) : rows.results).map((hit) => ({
      object: 'inbound_message' as const,
      id: hit.id,
      thread_id: hit.thread_id,
      mailbox_id: hit.mailbox_id,
      from: hit.from_address,
      subject: hit.subject,
      snippet: hit.snippet,
      received_at: hit.at,
    })),
    has_more: hasMore,
    next_cursor: null,
  })
})

inbound.delete('/threads/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'inbound:write')
  requireRole(ctx.actor, 'developer')
  const thread = await loadThread(ctx, c.req.param('id'))

  const messages = await listMessages(ctx, thread.id)
  const { deleteThreadRows } = await import('../services/mail.ts')
  await deleteThreadRows(ctx.sql, ctx.workspace.id, thread.id)
  await ctx.sql
    .prepare('DELETE FROM inbound_messages WHERE workspace_id = ? AND thread_id = ?')
    .bind(ctx.workspace.id, thread.id)
    .run()

  const keys = messages.flatMap((row) =>
    [row.raw_key, row.body_key].filter((k): k is string => Boolean(k)),
  )
  if (keys.length) ctx.background(ctx.blob.delete(keys))

  return json({
    object: 'inbound_thread',
    id: thread.id,
    deleted: true,
    messages_deleted: messages.length,
  })
})

// ---------------------------------------------------------------------------

async function loadThread(ctx: Ctx, id: string): Promise<ThreadRow> {
  const row = await ctx.sql
    .prepare(
      `SELECT id, mailbox_id, subject, participants, message_count, unread_count,
              last_message_at, created_at
         FROM mail_threads WHERE id = ? AND workspace_id = ?`,
    )
    .bind(id, ctx.workspace.id)
    .first<ThreadRow>()
  if (!row) throw apiError('not_found')
  return row
}

const MESSAGE_COLUMNS = `id, thread_id, mailbox_id, message_id_header, in_reply_to, from_address,
  to_addresses, subject, snippet, body_key, raw_key, spf, dkim, dmarc, spam_score,
  parse_status, matched_by, at`

async function listMessages(ctx: Ctx, threadId: string): Promise<MessageRow[]> {
  const rows = await ctx.sql
    .prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM mail_messages
        WHERE workspace_id = ? AND thread_id = ? ORDER BY at ASC LIMIT 200`,
    )
    .bind(ctx.workspace.id, threadId)
    .all<MessageRow>()
  return rows.results
}

async function loadMessage(ctx: Ctx, id: string): Promise<MessageRow> {
  const row = await ctx.sql
    .prepare(`SELECT ${MESSAGE_COLUMNS} FROM mail_messages WHERE id = ? AND workspace_id = ?`)
    .bind(id, ctx.workspace.id)
    .first<MessageRow>()
  if (!row) throw apiError('not_found')
  return row
}

async function defaultFrom(ctx: Ctx, mailboxId: string | null): Promise<string | null> {
  if (!mailboxId) return null
  const row = await ctx.sql
    .prepare('SELECT address FROM inbound_mailboxes WHERE id = ? AND workspace_id = ?')
    .bind(mailboxId, ctx.workspace.id)
    .first<{ address: string }>()
  return row?.address ?? null
}

async function withBody(ctx: Ctx, row: MessageRow) {
  const object = row.body_key ? await ctx.blob.get(row.body_key).catch(() => null) : null
  const parsed = object
    ? ((await object.json()) as { html?: string | null; text?: string | null })
    : null

  const attachments = await ctx.sql
    .prepare(
      `SELECT id, filename, content_type, size FROM mail_attachments
        WHERE workspace_id = ? AND message_id = ? ORDER BY id`,
    )
    .bind(ctx.workspace.id, row.id)
    .all<{ id: string; filename: string; content_type: string; size: number }>()

  return {
    object: 'inbound_message' as const,
    id: row.id,
    thread_id: row.thread_id,
    mailbox_id: row.mailbox_id,
    from: row.from_address,
    to: parseJsonList(row.to_addresses),
    subject: row.subject,
    snippet: row.snippet,
    html: parsed?.html ?? null,
    text: parsed?.text ?? null,
    body_available: Boolean(object),
    message_id: row.message_id_header,
    in_reply_to: row.in_reply_to,
    spf: row.spf,
    dkim: row.dkim,
    dmarc: row.dmarc,
    spam_score: row.spam_score,
    parse_status: row.parse_status,
    matched_by: row.matched_by,
    attachments: attachments.results.map((a) => ({
      filename: a.filename,
      content_type: a.content_type,
      size: a.size,
      url: `/v1/mail/attachments/${a.id}`,
    })),
    received_at: row.at,
  }
}

export { inbound }
