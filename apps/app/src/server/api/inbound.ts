import { apiError, SendEmailRequest } from '@mailysend/contracts'
import { doName, newId, r2Key } from '@mailysend/core'
import { z } from 'zod'
import { requireRole, requireScope } from '../auth.ts'
import type { Ctx } from '../context.ts'
import { acceptEmail } from '../send/accept.ts'
import { type App, createRouter, json, page, parseLimit, withContext } from './base.ts'

/**
 * `/v1/inbound` — received mail.
 *
 * Threads and the search index live in each mailbox's own actor, because a
 * mailbox is the natural serialisation point for threading and because FTS5
 * inside the actor answers "what did this customer say about refunds?" in one
 * hop. Bodies never go in there: they stay in object storage, which is what
 * keeps a mailbox with a decade of mail in it small enough to search.
 *
 * `inbound_threads` in SQL is the existence record. A thread the customer
 * deleted is gone from there, so listings and search results are filtered
 * against it rather than trusting the actor's index, which is append-only.
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

interface InboundMessageRow {
  id: string
  thread_id: string
  mailbox_id: string
  message_id_header: string | null
  in_reply_to: string | null
  from_address: string
  to_addresses: string
  subject: string
  snippet: string
  raw_key: string
  body_key: string | null
  spf: string | null
  dkim: string | null
  dmarc: string | null
  spam_score: number | null
  parse_status: string
  matched_by: string | null
  received_at: string
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

  const address = body.address.toLowerCase()
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
    note: "Mail reaches this address once the domain's MX records point at MailySend.",
  })
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

inbound.get('/threads', async (c) => {
  const ctx = c.get('ctx')
  const limit = parseLimit(c.req.query('limit'))
  const before = c.req.query('cursor') ?? c.req.query('before')
  const unreadOnly = c.req.query('unread') === 'true'
  const mailboxes = await listMailboxes(ctx, c.req.query('mailbox_id'))

  const collected: ThreadSummary[] = []
  for (const mailbox of mailboxes) {
    const stub = ctx.env.MAILBOX.get(doName('Mailbox', ctx.workspace.id, mailbox.id))
    const threads = await stub.listThreads({ limit: limit + 1, before, unreadOnly })
    for (const thread of threads as ActorThread[]) {
      collected.push({
        object: 'inbound_thread',
        id: thread.id,
        mailbox_id: mailbox.id,
        subject: thread.subject,
        participants: parseJsonList(thread.participants),
        message_count: thread.message_count,
        unread: Boolean(thread.unread),
        last_message_at: thread.last_message_at,
      })
    }
  }

  collected.sort((a, b) => (a.last_message_at < b.last_message_at ? 1 : -1))
  const live = await filterLiveThreads(ctx, collected)
  const paged = page(live, limit)

  return json({
    ...paged,
    // The actor pages on time, not on the id, so the cursor is a timestamp.
    next_cursor: paged.has_more ? (paged.data.at(-1)?.last_message_at ?? null) : null,
  })
})

inbound.get('/threads/:id', async (c) => {
  const ctx = c.get('ctx')
  const threadId = c.req.param('id')
  const thread = await ctx.sql
    .prepare(
      `SELECT id, mailbox_id, subject, participants, message_count, unread, last_message_at, created_at
         FROM inbound_threads WHERE id = ? AND workspace_id = ?`,
    )
    .bind(threadId, ctx.workspace.id)
    .first<{
      id: string
      mailbox_id: string
      subject: string
      participants: string
      message_count: number
      unread: number
      last_message_at: string
      created_at: string
    }>()
  if (!thread) throw apiError('not_found')

  const rows = await ctx.sql
    .prepare(
      `SELECT id, thread_id, mailbox_id, message_id_header, in_reply_to, from_address, to_addresses,
              subject, snippet, raw_key, body_key, spf, dkim, dmarc, spam_score, parse_status,
              matched_by, received_at
         FROM inbound_messages WHERE workspace_id = ? AND thread_id = ?
        ORDER BY received_at ASC LIMIT 200`,
    )
    .bind(ctx.workspace.id, threadId)
    .all<InboundMessageRow>()

  const messages = await Promise.all(rows.results.map((row) => withBody(ctx, row)))

  ctx.background(
    ctx.env.MAILBOX.get(doName('Mailbox', ctx.workspace.id, thread.mailbox_id)).markRead(
      threadId,
      true,
    ),
  )

  return json({
    object: 'inbound_thread',
    id: thread.id,
    mailbox_id: thread.mailbox_id,
    subject: thread.subject,
    participants: parseJsonList(thread.participants),
    message_count: thread.message_count,
    unread: Boolean(thread.unread),
    last_message_at: thread.last_message_at,
    messages,
  })
})

inbound.get('/messages/:id', async (c) => {
  const ctx = c.get('ctx')
  const row = await loadMessage(ctx, c.req.param('id'))
  return json(await withBody(ctx, row))
})

/** The original MIME, byte for byte. The only thing that settles an argument about a header. */
inbound.get('/messages/:id/raw', async (c) => {
  const ctx = c.get('ctx')
  const row = await loadMessage(ctx, c.req.param('id'))
  const object = await ctx.blob.get(row.raw_key)
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
      from: z.string().min(3).max(320),
      to: z.array(z.string().min(3).max(320)).min(1).max(50).optional(),
      subject: z.string().max(998).optional(),
      html: z.string().max(2_000_000).optional(),
      text: z.string().max(2_000_000).optional(),
    })
    .parse(await c.req.json())
  if (!body.html && !body.text) {
    throw apiError('no_content', { param: 'html' })
  }

  const threadId = c.req.param('id')
  const rows = await ctx.sql
    .prepare(
      `SELECT id, message_id_header, from_address, subject, received_at
         FROM inbound_messages WHERE workspace_id = ? AND thread_id = ?
        ORDER BY received_at ASC LIMIT 200`,
    )
    .bind(ctx.workspace.id, threadId)
    .all<{
      id: string
      message_id_header: string | null
      from_address: string
      subject: string
      received_at: string
    }>()
  if (rows.results.length === 0) throw apiError('not_found')

  const last = rows.results.at(-1)!
  const references = rows.results
    .map((row) => row.message_id_header)
    .filter((value): value is string => Boolean(value))

  const headers: Record<string, string> = {}
  if (last.message_id_header) headers['In-Reply-To'] = last.message_id_header
  // References carries the whole chain; clients thread on it when In-Reply-To
  // has been rewritten by an intermediary, which happens constantly.
  if (references.length) headers.References = references.join(' ')

  const subject =
    body.subject ?? (/^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`)
  const request = SendEmailRequest.parse({
    from: body.from,
    to: body.to ?? [last.from_address],
    subject: subject || '(no subject)',
    html: body.html,
    text: body.text,
    headers,
  })
  const accepted = await acceptEmail(ctx, request)

  return json({
    object: 'inbound_reply',
    thread_id: threadId,
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
  const mailboxes = await listMailboxes(ctx, c.req.query('mailbox_id'))

  const hits: SearchHit[] = []
  for (const mailbox of mailboxes) {
    const stub = ctx.env.MAILBOX.get(doName('Mailbox', ctx.workspace.id, mailbox.id))
    for (const hit of (await stub.search(query, limit)) as ActorMessage[]) {
      hits.push({
        object: 'inbound_message',
        id: hit.id,
        thread_id: hit.thread_id,
        mailbox_id: mailbox.id,
        from: hit.from_address,
        subject: hit.subject,
        snippet: hit.snippet,
        received_at: hit.received_at,
      })
    }
  }

  hits.sort((a, b) => (a.received_at < b.received_at ? 1 : -1))
  const live = await filterLiveThreads(ctx, hits)
  return json({
    object: 'list',
    data: live.slice(0, limit),
    has_more: live.length > limit,
    next_cursor: null,
  })
})

/**
 * Deleting a thread removes the SQL record and the stored bodies.
 *
 * The mailbox actor's index is append-only, so its headers survive until the
 * mailbox is compacted; filtering every read through `inbound_threads` is what
 * makes the deletion true from the outside on the very next request.
 */
inbound.delete('/threads/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'inbound:write')
  requireRole(ctx.actor, 'developer')
  const threadId = c.req.param('id')

  const messages = await ctx.sql
    .prepare(
      'SELECT id, raw_key, body_key FROM inbound_messages WHERE workspace_id = ? AND thread_id = ?',
    )
    .bind(ctx.workspace.id, threadId)
    .all<{ id: string; raw_key: string; body_key: string | null }>()

  const res = await ctx.sql
    .prepare('DELETE FROM inbound_threads WHERE id = ? AND workspace_id = ?')
    .bind(threadId, ctx.workspace.id)
    .run()
  if (res.meta.changes === 0) throw apiError('not_found')

  await ctx.sql
    .prepare('DELETE FROM inbound_messages WHERE workspace_id = ? AND thread_id = ?')
    .bind(ctx.workspace.id, threadId)
    .run()

  const keys = messages.results.flatMap((row) =>
    [row.raw_key, row.body_key].filter((k): k is string => Boolean(k)),
  )
  if (keys.length) ctx.background(ctx.blob.delete(keys))

  return json({
    object: 'inbound_thread',
    id: threadId,
    deleted: true,
    messages_deleted: messages.results.length,
  })
})

// ---------------------------------------------------------------------------

interface ThreadSummary {
  object: 'inbound_thread'
  id: string
  mailbox_id: string
  subject: string
  participants: string[]
  message_count: number
  unread: boolean
  last_message_at: string
}

interface SearchHit {
  object: 'inbound_message'
  id: string
  thread_id: string
  mailbox_id: string
  from: string
  subject: string
  snippet: string
  received_at: string
}

interface ActorThread {
  id: string
  subject: string
  participants: string
  message_count: number
  unread: number
  last_message_at: string
}

interface ActorMessage {
  id: string
  thread_id: string
  from_address: string
  subject: string
  snippet: string
  received_at: string
}

const parseJsonList = (raw: string | null): string[] => {
  if (!raw) return []
  try {
    return JSON.parse(raw) as string[]
  } catch {
    // Participants written before the column was JSON, or by a different tool.
    return raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  }
}

async function listMailboxes(ctx: Ctx, mailboxId?: string): Promise<{ id: string }[]> {
  const rows = await ctx.sql
    .prepare(
      `SELECT id FROM inbound_mailboxes WHERE workspace_id = ?${mailboxId ? ' AND id = ?' : ''}
        ORDER BY id ASC LIMIT 20`,
    )
    .bind(ctx.workspace.id, ...(mailboxId ? [mailboxId] : []))
    .all<{ id: string }>()
  if (mailboxId && rows.results.length === 0)
    throw apiError('not_found', { message: 'No such mailbox.' })
  return rows.results
}

/** Drops rows whose thread no longer exists in SQL — see the DELETE handler. */
async function filterLiveThreads<T extends { id?: string; thread_id?: string }>(
  ctx: Ctx,
  rows: T[],
): Promise<T[]> {
  const ids = [
    ...new Set(
      rows.map((row) => row.thread_id ?? row.id).filter((id): id is string => Boolean(id)),
    ),
  ]
  if (ids.length === 0) return rows
  const live = await ctx.sql
    .prepare(
      `SELECT id FROM inbound_threads WHERE workspace_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
    )
    .bind(ctx.workspace.id, ...ids)
    .all<{ id: string }>()
  const kept = new Set(live.results.map((row) => row.id))
  return rows.filter((row) => kept.has(row.thread_id ?? row.id ?? ''))
}

async function loadMessage(ctx: Ctx, id: string): Promise<InboundMessageRow> {
  const row = await ctx.sql
    .prepare(
      `SELECT id, thread_id, mailbox_id, message_id_header, in_reply_to, from_address, to_addresses,
              subject, snippet, raw_key, body_key, spf, dkim, dmarc, spam_score, parse_status,
              matched_by, received_at
         FROM inbound_messages WHERE id = ? AND workspace_id = ?`,
    )
    .bind(id, ctx.workspace.id)
    .first<InboundMessageRow>()
  if (!row) throw apiError('not_found')
  return row
}

async function withBody(ctx: Ctx, row: InboundMessageRow) {
  const key = row.body_key ?? r2Key.inbound(ctx.workspace.id, row.thread_id, `${row.id}.json`)
  const object = await ctx.blob.get(key).catch(() => null)
  const parsed = object
    ? ((await object.json()) as { html?: string | null; text?: string | null })
    : null

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
    received_at: row.received_at,
  }
}

export { inbound }
