import { apiError, SendEmailRequest } from '@mailysend/contracts'
import { newId, signReplyToken } from '@mailysend/core'
import PostalMime from 'postal-mime'
import { z } from 'zod'
import { compileMailQuery } from '../../lib/mail-search.ts'
import { requireRole, requireScope } from '../auth.ts'
import type { Ctx } from '../context.ts'
import { acceptEmail } from '../send/accept.ts'
import { deleteThreadRows, replyAddress } from '../services/mail.ts'
import { type App, createRouter, json, parseLimit, withContext } from './base.ts'

/**
 * `/v1/mail` — the conversation surface.
 *
 * One router for both directions. `/v1/inbound` still exists and still answers,
 * because it is a documented public API and an SDK is using it; it is now a
 * view over the same tables rather than a second implementation.
 *
 * Everything here is scoped by environment as well as workspace. `test` is a
 * real inbox, fed by the send path's loopback, and it is the reason a brand-new
 * instance with no domain and no credentials can still demonstrate the whole
 * product to the person who just deployed it.
 */

const mail: App = createRouter()

mail.use('*', withContext())

const FOLDERS = ['inbox', 'sent', 'archive', 'spam', 'trash'] as const

interface ThreadRow {
  id: string
  mailbox_id: string | null
  environment: string
  subject: string
  participants: string
  message_count: number
  unread_count: number
  has_attachments: number
  starred: number
  folder: string
  labels: string | null
  snoozed_until: string | null
  last_message_at: string
  last_direction: string
  snippet: string
  created_at: string
}

interface MessageRow {
  id: string
  thread_id: string
  direction: string
  mailbox_id: string | null
  source_id: string | null
  message_id_header: string | null
  in_reply_to: string | null
  references_json: string | null
  from_address: string
  from_name: string | null
  to_addresses: string
  cc_addresses: string | null
  bcc_addresses: string | null
  reply_to: string | null
  subject: string
  snippet: string
  has_attachments: number
  unread: number
  size_bytes: number | null
  body_key: string | null
  raw_key: string | null
  spf: string | null
  dkim: string | null
  dmarc: string | null
  spam_score: number | null
  parse_status: string
  matched_by: string | null
  status: string | null
  at: string
}

const parseList = (raw: string | null): string[] => {
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? (value as string[]) : []
  } catch {
    return raw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  }
}

const toThread = (row: ThreadRow) => ({
  object: 'mail_thread' as const,
  id: row.id,
  mailbox_id: row.mailbox_id,
  environment: row.environment,
  subject: row.subject,
  participants: parseList(row.participants),
  message_count: row.message_count,
  unread_count: row.unread_count,
  unread: row.unread_count > 0,
  has_attachments: Boolean(row.has_attachments),
  starred: Boolean(row.starred),
  folder: row.folder,
  labels: parseList(row.labels),
  snoozed_until: row.snoozed_until,
  last_message_at: row.last_message_at,
  last_direction: row.last_direction,
  snippet: row.snippet,
  created_at: row.created_at,
})

const toMessage = (row: MessageRow) => ({
  object: 'mail_message' as const,
  id: row.id,
  thread_id: row.thread_id,
  direction: row.direction,
  mailbox_id: row.mailbox_id,
  /** The `messages` / `inbound_messages` row that owns the delivery facts. */
  source_id: row.source_id,
  message_id: row.message_id_header,
  in_reply_to: row.in_reply_to,
  references: parseList(row.references_json),
  from: row.from_address,
  from_name: row.from_name,
  to: parseList(row.to_addresses),
  cc: parseList(row.cc_addresses),
  bcc: parseList(row.bcc_addresses),
  reply_to: row.reply_to,
  subject: row.subject,
  snippet: row.snippet,
  has_attachments: Boolean(row.has_attachments),
  unread: Boolean(row.unread),
  size_bytes: row.size_bytes,
  spf: row.spf,
  dkim: row.dkim,
  dmarc: row.dmarc,
  spam_score: row.spam_score,
  parse_status: row.parse_status,
  matched_by: row.matched_by,
  status: row.status,
  at: row.at,
  /** Only outbound messages have a delivery timeline to link to. */
  email_id: row.direction === 'out' ? row.source_id : null,
})

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/**
 * The thread list.
 *
 * Search and browse are the same endpoint on purpose: a folder is just
 * `in:archive`, and having two code paths is how a filter ends up applying in
 * one of them and not the other.
 */
mail.get('/threads', async (c) => {
  const ctx = c.get('ctx')
  const limit = parseLimit(c.req.query('limit'), 50, 100)
  const cursor = c.req.query('cursor')
  const query = c.req.query('q') ?? ''
  const folder = c.req.query('folder')

  const where = ['t.workspace_id = ?', 't.environment = ?']
  const params: unknown[] = [ctx.workspace.id, ctx.actor.environment]

  if (folder && (FOLDERS as readonly string[]).includes(folder)) {
    where.push('t.folder = ?')
    params.push(folder)
  } else if (!query) {
    // No folder and no query means the inbox. Trash and spam are never in a
    // default listing, which is the whole reason they are folders.
    where.push("t.folder NOT IN ('trash', 'spam')")
  }

  const compiled = compileMailQuery(query)
  where.push(...compiled.where)
  params.push(...compiled.params)

  // A snoozed conversation is hidden until its time comes. The cron un-snoozes
  // it; this predicate is what makes the hiding true in the meantime.
  where.push('(t.snoozed_until IS NULL OR t.snoozed_until <= ?)')
  params.push(new Date().toISOString())

  if (cursor) {
    where.push('t.last_message_at < ?')
    params.push(cursor)
  }

  // Full-text terms narrow to a set of thread ids first. Keeping the FTS match
  // in a subquery rather than a join condition means the operators above are
  // evaluated against indexed columns on `mail_threads`, not against FTS output.
  //
  // The two variants are written out in full rather than assembled from a
  // fragment, so each one is a complete statement that SQLite's own parser can
  // check — which is what `schema-usage.test.ts` does to every literal here.
  if (compiled.match) {
    params.unshift(ctx.workspace.id, ctx.actor.environment, compiled.match)
  }

  // `m` is the thread's most recent message: the operators that name a sender
  // or a recipient are about the conversation, not about one message in it.
  const lastMessage = `LEFT JOIN mail_messages m ON m.id = (
      SELECT id FROM mail_messages
       WHERE workspace_id = t.workspace_id AND thread_id = t.id
       ORDER BY at DESC LIMIT 1)`

  const sql = compiled.match
    ? `SELECT t.* FROM mail_threads t
         JOIN (SELECT DISTINCT thread_id FROM mail_search
                WHERE workspace_id = ? AND environment = ? AND mail_search MATCH ?) hits
           ON hits.thread_id = t.id
         ${lastMessage}
        WHERE ${where.join(' AND ')}
        ORDER BY t.last_message_at DESC
        LIMIT ?`
    : `SELECT t.* FROM mail_threads t
         ${lastMessage}
        WHERE ${where.join(' AND ')}
        ORDER BY t.last_message_at DESC
        LIMIT ?`

  const rows = await ctx.sql
    .prepare(sql)
    .bind(...params, limit + 1)
    .all<ThreadRow>()

  const hasMore = rows.results.length > limit
  const data = (hasMore ? rows.results.slice(0, limit) : rows.results).map(toThread)
  return json({
    object: 'list',
    data,
    has_more: hasMore,
    next_cursor: hasMore ? (data.at(-1)?.last_message_at ?? null) : null,
    query: compiled.terms,
  })
})

/** Per-folder counts for the rail. One query, not five. */
mail.get('/counts', async (c) => {
  const ctx = c.get('ctx')
  const rows = await ctx.sql
    .prepare(
      `SELECT folder,
              COUNT(*) AS threads,
              SUM(CASE WHEN unread_count > 0 THEN 1 ELSE 0 END) AS unread
         FROM mail_threads
        WHERE workspace_id = ? AND environment = ?
          AND (snoozed_until IS NULL OR snoozed_until <= ?)
        GROUP BY folder`,
    )
    .bind(ctx.workspace.id, ctx.actor.environment, new Date().toISOString())
    .all<{ folder: string; threads: number; unread: number }>()

  const counts = Object.fromEntries(FOLDERS.map((f) => [f, { threads: 0, unread: 0 }]))
  for (const row of rows.results) {
    counts[row.folder] = { threads: row.threads, unread: row.unread ?? 0 }
  }
  return json({ object: 'mail_counts', environment: ctx.actor.environment, folders: counts })
})

mail.get('/threads/:id', async (c) => {
  const ctx = c.get('ctx')
  const thread = await loadThread(ctx, c.req.param('id'))

  const rows = await ctx.sql
    .prepare(
      `SELECT * FROM mail_messages
        WHERE workspace_id = ? AND thread_id = ? ORDER BY at ASC LIMIT 500`,
    )
    .bind(ctx.workspace.id, thread.id)
    .all<MessageRow>()

  const messages = await Promise.all(rows.results.map((row) => withBody(ctx, row)))

  return json({ ...toThread(thread), messages })
})

mail.get('/threads/:id/messages', async (c) => {
  const ctx = c.get('ctx')
  const thread = await loadThread(ctx, c.req.param('id'))
  const rows = await ctx.sql
    .prepare(
      `SELECT * FROM mail_messages
        WHERE workspace_id = ? AND thread_id = ? ORDER BY at ASC LIMIT 500`,
    )
    .bind(ctx.workspace.id, thread.id)
    .all<MessageRow>()
  const data = await Promise.all(rows.results.map((row) => withBody(ctx, row)))
  return json({ object: 'list', data, has_more: false, next_cursor: null })
})

const ThreadPatch = z.object({
  unread: z.boolean().optional(),
  starred: z.boolean().optional(),
  folder: z.enum(FOLDERS).optional(),
  labels: z.array(z.string().max(64)).max(50).optional(),
  snoozed_until: z.string().datetime().nullable().optional(),
})

mail.patch('/threads/:id', async (c) => {
  const ctx = c.get('ctx')
  const body = ThreadPatch.parse(await c.req.json())
  const thread = await loadThread(ctx, c.req.param('id'))
  await applyPatch(ctx, [thread.id], body)
  return json(toThread(await loadThread(ctx, thread.id)))
})

/**
 * Bulk actions.
 *
 * A separate endpoint rather than N calls: selecting fifty conversations and
 * archiving them is one intent, and fifty requests turn a single undo into
 * fifty partial states.
 */
mail.post('/threads/bulk', async (c) => {
  const ctx = c.get('ctx')
  const body = z
    .object({ ids: z.array(z.string().max(64)).min(1).max(200) })
    .and(ThreadPatch)
    .parse(await c.req.json())
  const { ids, ...patch } = body
  const owned = await ctx.sql
    .prepare(
      `SELECT id FROM mail_threads WHERE workspace_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
    )
    .bind(ctx.workspace.id, ...ids)
    .all<{ id: string }>()
  if (owned.results.length === 0) throw apiError('not_found')
  await applyPatch(
    ctx,
    owned.results.map((r) => r.id),
    patch,
  )
  return json({ object: 'mail_bulk', updated: owned.results.length })
})

mail.delete('/threads/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'inbound:write')
  requireRole(ctx.actor, 'developer')
  const thread = await loadThread(ctx, c.req.param('id'))

  const rows = await ctx.sql
    .prepare('SELECT body_key, raw_key FROM mail_messages WHERE workspace_id = ? AND thread_id = ?')
    .bind(ctx.workspace.id, thread.id)
    .all<{ body_key: string | null; raw_key: string | null }>()
  const attachments = await ctx.sql
    .prepare('SELECT blob_key FROM mail_attachments WHERE workspace_id = ? AND thread_id = ?')
    .bind(ctx.workspace.id, thread.id)
    .all<{ blob_key: string }>()

  await deleteThreadRows(ctx.sql, ctx.workspace.id, thread.id)
  // The legacy tables are the source for the `/v1/inbound` compatibility view,
  // so a deletion has to be true there too.
  await ctx.sql
    .prepare('DELETE FROM inbound_messages WHERE workspace_id = ? AND thread_id = ?')
    .bind(ctx.workspace.id, thread.id)
    .run()
  await ctx.sql
    .prepare('DELETE FROM inbound_threads WHERE workspace_id = ? AND id = ?')
    .bind(ctx.workspace.id, thread.id)
    .run()

  const keys = [
    ...rows.results.flatMap((r) => [r.body_key, r.raw_key]),
    ...attachments.results.map((r) => r.blob_key),
  ].filter((k): k is string => Boolean(k))
  if (keys.length) ctx.background(ctx.blob.delete(keys))

  return json({ object: 'mail_thread', id: thread.id, deleted: true })
})

// ---------------------------------------------------------------------------
// Messages, attachments and the raw bytes
// ---------------------------------------------------------------------------

mail.get('/messages/:id', async (c) => {
  const ctx = c.get('ctx')
  return json(await withBody(ctx, await loadMessage(ctx, c.req.param('id'))))
})

/** The original MIME, byte for byte. The only thing that settles a header argument. */
mail.get('/messages/:id/raw', async (c) => {
  const ctx = c.get('ctx')
  const row = await loadMessage(ctx, c.req.param('id'))
  if (!row.raw_key) {
    throw apiError('not_found', {
      message: 'This message has no stored original — it was composed here and sent, not received.',
    })
  }
  const object = await ctx.blob.get(row.raw_key)
  if (!object) throw apiError('not_found', { message: 'The raw message is no longer in storage.' })
  return new Response(await object.text(), {
    headers: {
      'content-type': 'message/rfc822',
      'content-disposition': `attachment; filename="${row.id}.eml"`,
    },
  })
})

/**
 * Every header, in order, as they arrived.
 *
 * Parsed here rather than in the browser because the raw message can be 25 MB
 * and the headers are the first two kilobytes of it.
 */
mail.get('/messages/:id/headers', async (c) => {
  const ctx = c.get('ctx')
  const row = await loadMessage(ctx, c.req.param('id'))
  if (!row.raw_key) return json({ object: 'list', data: [], has_more: false, next_cursor: null })
  const object = await ctx.blob.get(row.raw_key)
  if (!object) throw apiError('not_found')
  const parsed = await PostalMime.parse(await object.arrayBuffer())
  return json({
    object: 'list',
    data: (parsed.headers ?? []).map((h) => ({ name: h.key, value: h.value })),
    has_more: false,
    next_cursor: null,
  })
})

mail.get('/attachments/:id', async (c) => {
  const ctx = c.get('ctx')
  const row = await ctx.sql
    .prepare(
      `SELECT filename, content_type, size, blob_key, inline
         FROM mail_attachments WHERE id = ? AND workspace_id = ?`,
    )
    .bind(c.req.param('id'), ctx.workspace.id)
    .first<{
      filename: string
      content_type: string
      size: number
      blob_key: string
      inline: number
    }>()
  if (!row) throw apiError('not_found')
  const object = await ctx.blob.get(row.blob_key)
  if (!object) throw apiError('not_found', { message: 'The attachment is no longer in storage.' })

  // `attachment`, never `inline`, even for a cid: image: the reading pane
  // fetches these itself and hands the frame a blob: URL, so nothing here is
  // ever rendered as a top-level document on our own origin.
  return new Response(await object.arrayBuffer(), {
    headers: {
      'content-type': row.content_type,
      'content-length': String(row.size),
      'content-disposition': `attachment; filename="${row.filename.replace(/["\\]/g, '')}"`,
      'x-content-type-options': 'nosniff',
    },
  })
})

/** Compose-time upload. Returns the key the send path re-reads. */
mail.post('/attachments', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'emails:send')
  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    throw apiError('validation_error', { message: '`file` is required.', param: 'file' })
  }
  if (file.size > 20 * 1024 * 1024) {
    throw apiError('validation_error', {
      message: 'Attachments are limited to 20 MB. Most providers reject more than that anyway.',
      param: 'file',
    })
  }
  const id = newId('attachment')
  const key = `draft/${ctx.workspace.id}/${id}`
  await ctx.blob.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  })
  return json({
    object: 'mail_upload',
    id,
    key,
    filename: file.name,
    content_type: file.type || 'application/octet-stream',
    size: file.size,
  })
})

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

const ComposeRequest = z.object({
  thread_id: z.string().max(64).optional(),
  from: z.string().min(3).max(320),
  to: z.array(z.string().min(3).max(320)).min(1).max(50),
  cc: z.array(z.string().min(3).max(320)).max(50).optional(),
  bcc: z.array(z.string().min(3).max(320)).max(50).optional(),
  /**
   * Where replies should go when that is not the From address — which is the
   * normal case for a send-only identity on a verified domain with no mailbox
   * behind it.
   */
  reply_to: z.array(z.string().min(3).max(320)).max(10).optional(),
  subject: z.string().max(998).optional(),
  html: z.string().max(2_000_000).optional(),
  text: z.string().max(2_000_000).optional(),
  attachments: z
    .array(
      z.object({
        key: z.string().max(300),
        filename: z.string().max(200),
        content_type: z.string().max(120).optional(),
      }),
    )
    .max(20)
    .optional(),
  scheduled_at: z.string().max(64).optional(),
  /** `reply`, `reply_all` and `forward` differ only in what the client prefills. */
  in_reply_to: z.string().max(998).optional(),
  references: z.array(z.string().max(998)).max(50).optional(),
})

/**
 * Compose and send.
 *
 * Goes through `acceptEmail` like every other send — same suppression checks,
 * same domain governor, same log row, same idempotency. A message composed in
 * the dashboard is not a special kind of message, and the moment it becomes one
 * is the moment the dashboard stops being a test of the product.
 */
mail.post('/send', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'emails:send')
  const body = ComposeRequest.parse(await c.req.json())
  if (!body.html && !body.text) throw apiError('no_content', { param: 'html' })

  const headers: Record<string, string> = {}
  let references = body.references ?? []
  let inReplyTo = body.in_reply_to ?? null
  let subject = body.subject ?? ''

  if (body.thread_id) {
    const thread = await loadThread(ctx, body.thread_id)
    const rows = await ctx.sql
      .prepare(
        `SELECT message_id_header, subject FROM mail_messages
          WHERE workspace_id = ? AND thread_id = ? ORDER BY at ASC LIMIT 500`,
      )
      .bind(ctx.workspace.id, thread.id)
      .all<{ message_id_header: string | null; subject: string }>()
    const chain = rows.results
      .map((r) => r.message_id_header)
      .filter((v): v is string => Boolean(v))
    inReplyTo = inReplyTo ?? chain.at(-1) ?? null
    // References carries the whole chain; clients thread on it when In-Reply-To
    // has been rewritten by an intermediary, which happens constantly.
    references = references.length ? references : chain
    subject = subject || (/^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`)
  }

  if (inReplyTo) headers['In-Reply-To'] = inReplyTo
  if (references.length) headers.References = references.join(' ')

  // The reply token — minted here for the first time. `MailboxActor` has always
  // had `matched_by = 'reply_token'` as its highest-confidence branch and
  // `signReplyToken` has always existed; nothing ever called it, so the branch
  // could not fire. Inviting the reply back to a per-thread address closes it.
  const replyTo = await mintReplyTo(ctx, body.thread_id ?? null)

  const attachments = await Promise.all(
    (body.attachments ?? []).map(async (attachment) => {
      const object = await ctx.blob.get(attachment.key)
      if (!object) {
        throw apiError('validation_error', {
          message: `The upload \`${attachment.filename}\` has expired. Attach it again.`,
          param: 'attachments',
        })
      }
      const bytes = new Uint8Array(await object.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      }
      return {
        filename: attachment.filename,
        content: btoa(binary),
        content_type: attachment.content_type ?? 'application/octet-stream',
      }
    }),
  )

  const request = SendEmailRequest.parse({
    from: body.from,
    to: body.to,
    ...(body.cc?.length ? { cc: body.cc } : {}),
    ...(body.bcc?.length ? { bcc: body.bcc } : {}),
    subject: subject || '(no subject)',
    ...(body.html ? { html: body.html } : {}),
    ...(body.text ? { text: body.text } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(body.scheduled_at ? { scheduled_at: body.scheduled_at } : {}),
    // An explicit Reply-To wins over the per-thread reply token: the author
    // asked for replies to go somewhere specific, and threading is the token's
    // convenience rather than its obligation.
    ...(body.reply_to?.length
      ? { reply_to: body.reply_to }
      : replyTo
        ? { reply_to: [replyTo] }
        : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
  })

  const accepted = await acceptEmail(ctx, request)
  return json({
    object: 'mail_send',
    id: accepted.id,
    thread_id: body.thread_id ?? null,
    environment: ctx.actor.environment,
    suppressed: accepted.suppressed,
    created_at: accepted.created_at,
  })
})

/**
 * `thr+<token>@<inbound domain>`.
 *
 * Only minted when the workspace actually has an inbound mailbox — a reply-to
 * address on a domain that receives nothing is a black hole, and pointing
 * someone's reply into one is worse than letting their client thread on
 * References.
 */
async function mintReplyTo(ctx: Ctx, threadId: string | null): Promise<string | null> {
  if (!threadId) return null
  const mailbox = await ctx.sql
    .prepare('SELECT address FROM inbound_mailboxes WHERE workspace_id = ? ORDER BY id LIMIT 1')
    .bind(ctx.workspace.id)
    .first<{ address: string }>()
  const domain = mailbox?.address.split('@')[1]
  if (!domain) return null
  const token = await signReplyToken(ctx.env.MS_SECRET, threadId, ctx.workspace.id)
  return replyAddress(token, domain)
}

// ---------------------------------------------------------------------------
// Labels and drafts
// ---------------------------------------------------------------------------

/**
 * `GET /v1/mail/identities` — every address this workspace can send as.
 *
 * There was no server-side notion of a sendable address until this endpoint:
 * the composer built one client-side by concatenating `mail@` onto the first
 * verified domain, which is why the From menu offered an address nobody had
 * created and never offered the mailboxes somebody had.
 *
 * Three sources, in the order a person would rank them:
 *   1. every `inbound_mailboxes` row whose domain the workspace owns — a real
 *      address that can receive the reply,
 *   2. one synthetic `hello@<domain>` per verified domain with no mailbox, so a
 *      workspace that has verified a domain and created nothing can still send,
 *   3. the test identity, in test mode, which needs no domain at all.
 *
 * `can_receive_replies` is the distinction that matters and the one the old
 * picker could not express: sending from an address with no mailbox behind it
 * works, and the reply goes nowhere.
 */
mail.get('/identities', async (c) => {
  const ctx = c.get('ctx')

  const [mailboxes, domains] = await Promise.all([
    ctx.sql
      .prepare(
        'SELECT id, address, name FROM inbound_mailboxes WHERE workspace_id = ? ORDER BY address',
      )
      .bind(ctx.workspace.id)
      .all<{ id: string; address: string; name: string | null }>(),
    ctx.sql
      .prepare('SELECT id, name, status FROM domains WHERE workspace_id = ? ORDER BY name')
      .bind(ctx.workspace.id)
      .all<{ id: string; name: string; status: string }>(),
  ])

  const byName = new Map(domains.results.map((d) => [d.name.toLowerCase(), d]))
  const data: {
    object: 'mail_identity'
    address: string
    name: string | null
    domain: string
    domain_id: string | null
    domain_status: string
    source: 'mailbox' | 'domain' | 'test'
    can_receive_replies: boolean
  }[] = []

  const claimed = new Set<string>()
  for (const box of mailboxes.results) {
    const domain = box.address.split('@')[1]?.toLowerCase() ?? ''
    const owned = byName.get(domain)
    // A mailbox on a domain the workspace does not own is not a sendable
    // identity — `POST /v1/inbound/mailboxes` used to accept any domain at all,
    // so rows like that exist and must not be offered here.
    if (!owned) continue
    claimed.add(domain)
    data.push({
      object: 'mail_identity',
      address: box.address,
      name: box.name,
      domain,
      domain_id: owned.id,
      domain_status: owned.status,
      source: 'mailbox',
      can_receive_replies: true,
    })
  }

  for (const domain of domains.results) {
    if (claimed.has(domain.name.toLowerCase())) continue
    if (domain.status !== 'verified') continue
    data.push({
      object: 'mail_identity',
      address: `hello@${domain.name}`,
      name: null,
      domain: domain.name,
      domain_id: domain.id,
      domain_status: domain.status,
      source: 'domain',
      can_receive_replies: false,
    })
  }

  if (ctx.actor.environment === 'test') {
    data.unshift({
      object: 'mail_identity',
      address: 'test@test.invalid',
      name: 'Test mode',
      domain: 'test.invalid',
      domain_id: null,
      domain_status: 'verified',
      source: 'test',
      can_receive_replies: true,
    })
  }

  return json({
    object: 'list',
    data,
    has_more: false,
    next_cursor: null,
    /**
     * The domains any local part may be typed on. The picker is free text by
     * design — the user asked to send from a hand-written inbox — and this is
     * what it validates the typed domain against before the server does.
     */
    sendable_domains: domains.results
      .filter((d) => d.status === 'verified')
      .map((d) => ({ id: d.id, name: d.name })),
  })
})

mail.get('/labels', async (c) => {
  const ctx = c.get('ctx')
  const rows = await ctx.sql
    .prepare(
      'SELECT id, name, colour, created_at FROM mail_labels WHERE workspace_id = ? ORDER BY name',
    )
    .bind(ctx.workspace.id)
    .all<{ id: string; name: string; colour: string; created_at: string }>()
  return json({
    object: 'list',
    data: rows.results.map((r) => ({ object: 'mail_label' as const, ...r })),
    has_more: false,
    next_cursor: null,
  })
})

mail.post('/labels', async (c) => {
  const ctx = c.get('ctx')
  const body = z
    .object({
      name: z.string().min(1).max(60),
      colour: z.enum(['neutral', 'accent', 'positive', 'warning', 'critical']).optional(),
    })
    .parse(await c.req.json())
  const id = newId('mailLabel')
  const now = new Date().toISOString()
  const res = await ctx.sql
    .prepare(
      `INSERT INTO mail_labels (id, workspace_id, name, colour, created_at) VALUES (?,?,?,?,?)
       ON CONFLICT DO NOTHING`,
    )
    .bind(id, ctx.workspace.id, body.name, body.colour ?? 'neutral', now)
    .run()
  if (res.meta.changes === 0) {
    throw apiError('validation_error', { message: 'That label already exists.', param: 'name' })
  }
  return json({
    object: 'mail_label',
    id,
    name: body.name,
    colour: body.colour ?? 'neutral',
    created_at: now,
  })
})

mail.delete('/labels/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const res = await ctx.sql
    .prepare('DELETE FROM mail_labels WHERE id = ? AND workspace_id = ?')
    .bind(id, ctx.workspace.id)
    .run()
  if (res.meta.changes === 0) throw apiError('not_found')
  // Threads keep a JSON array of ids; a deleted label has to leave them too, or
  // the rail shows a count for a label that no longer has a name.
  await ctx.sql
    .prepare(`UPDATE mail_threads SET labels = ? WHERE workspace_id = ? AND labels LIKE ?`)
    .bind('[]', ctx.workspace.id, `%"${id}"%`)
    .run()
  return json({ object: 'mail_label', id, deleted: true })
})

const DraftBody = z.object({
  thread_id: z.string().max(64).nullable().optional(),
  mode: z.enum(['new', 'reply', 'reply_all', 'forward']).optional(),
  from: z.string().max(320).nullable().optional(),
  to: z.array(z.string().max(320)).max(50).optional(),
  cc: z.array(z.string().max(320)).max(50).optional(),
  bcc: z.array(z.string().max(320)).max(50).optional(),
  subject: z.string().max(998).nullable().optional(),
  html: z.string().max(2_000_000).nullable().optional(),
  text: z.string().max(2_000_000).nullable().optional(),
  attachments: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
})

mail.get('/drafts', async (c) => {
  const ctx = c.get('ctx')
  const rows = await ctx.sql
    .prepare(
      `SELECT * FROM mail_drafts WHERE workspace_id = ? AND environment = ?
        ORDER BY updated_at DESC LIMIT 50`,
    )
    .bind(ctx.workspace.id, ctx.actor.environment)
    .all<Record<string, string | null>>()
  return json({
    object: 'list',
    data: rows.results.map(toDraft),
    has_more: false,
    next_cursor: null,
  })
})

mail.put('/drafts/:id', async (c) => {
  const ctx = c.get('ctx')
  const id = c.req.param('id')
  const body = DraftBody.parse(await c.req.json())
  const now = new Date().toISOString()
  await ctx.sql
    .prepare(
      `INSERT INTO mail_drafts (
         id, workspace_id, user_id, thread_id, mode, environment, from_address,
         to_addresses, cc_addresses, bcc_addresses, subject, html, text,
         in_reply_to, references_json, attachments, scheduled_at, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,NULL,?,?)
       ON CONFLICT(id) DO UPDATE SET
         thread_id = excluded.thread_id, mode = excluded.mode,
         from_address = excluded.from_address, to_addresses = excluded.to_addresses,
         cc_addresses = excluded.cc_addresses, bcc_addresses = excluded.bcc_addresses,
         subject = excluded.subject, html = excluded.html, text = excluded.text,
         attachments = excluded.attachments, updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      ctx.workspace.id,
      ctx.actor.userId ?? null,
      body.thread_id ?? null,
      body.mode ?? 'new',
      ctx.actor.environment,
      body.from ?? null,
      JSON.stringify(body.to ?? []),
      JSON.stringify(body.cc ?? []),
      JSON.stringify(body.bcc ?? []),
      body.subject ?? null,
      body.html ?? null,
      body.text ?? null,
      JSON.stringify(body.attachments ?? []),
      now,
      now,
    )
    .run()
  return json({ object: 'mail_draft', id, updated_at: now })
})

mail.delete('/drafts/:id', async (c) => {
  const ctx = c.get('ctx')
  await ctx.sql
    .prepare('DELETE FROM mail_drafts WHERE id = ? AND workspace_id = ?')
    .bind(c.req.param('id'), ctx.workspace.id)
    .run()
  return json({ object: 'mail_draft', id: c.req.param('id'), deleted: true })
})

const toDraft = (row: Record<string, string | null>) => ({
  object: 'mail_draft' as const,
  id: row.id as string,
  thread_id: row.thread_id,
  mode: row.mode,
  from: row.from_address,
  to: parseList(row.to_addresses ?? null),
  cc: parseList(row.cc_addresses ?? null),
  bcc: parseList(row.bcc_addresses ?? null),
  subject: row.subject,
  html: row.html,
  text: row.text,
  updated_at: row.updated_at,
})

// ---------------------------------------------------------------------------

async function loadThread(ctx: Ctx, id: string): Promise<ThreadRow> {
  const row = await ctx.sql
    .prepare('SELECT * FROM mail_threads WHERE id = ? AND workspace_id = ?')
    .bind(id, ctx.workspace.id)
    .first<ThreadRow>()
  if (!row) throw apiError('not_found')
  return row
}

async function loadMessage(ctx: Ctx, id: string): Promise<MessageRow> {
  const row = await ctx.sql
    .prepare('SELECT * FROM mail_messages WHERE id = ? AND workspace_id = ?')
    .bind(id, ctx.workspace.id)
    .first<MessageRow>()
  if (!row) throw apiError('not_found')
  return row
}

/**
 * A message plus its body and attachment list.
 *
 * The HTML is returned exactly as it arrived. Sanitising happens in the reading
 * pane, next to the frame that renders it, because the moment those two live in
 * different places one of them gets changed without the other — and because the
 * original has to stay intact for the "HTML source" tab to be worth anything.
 */
async function withBody(ctx: Ctx, row: MessageRow) {
  const key = row.body_key
  const object = key ? await ctx.blob.get(key).catch(() => null) : null
  const parsed = object
    ? ((await object.json()) as { html?: string | null; text?: string | null })
    : null

  const attachments = await ctx.sql
    .prepare(
      `SELECT id, filename, content_type, size, content_id, inline
         FROM mail_attachments WHERE workspace_id = ? AND message_id = ? ORDER BY id`,
    )
    .bind(ctx.workspace.id, row.id)
    .all<{
      id: string
      filename: string
      content_type: string
      size: number
      content_id: string | null
      inline: number
    }>()

  return {
    ...toMessage(row),
    html: parsed?.html ?? null,
    text: parsed?.text ?? null,
    body_available: Boolean(object),
    has_raw: Boolean(row.raw_key),
    attachments: attachments.results.map((a) => ({
      object: 'mail_attachment' as const,
      id: a.id,
      filename: a.filename,
      content_type: a.content_type,
      size: a.size,
      content_id: a.content_id,
      inline: Boolean(a.inline),
      url: `/v1/mail/attachments/${a.id}`,
    })),
  }
}

async function applyPatch(
  ctx: Ctx,
  ids: string[],
  patch: z.infer<typeof ThreadPatch>,
): Promise<void> {
  const sets: string[] = []
  const params: unknown[] = []

  if (patch.unread !== undefined) {
    // A thread's unread count is derived from its messages, so marking a
    // conversation read means marking its messages read — not overwriting a
    // counter that the next arrival would then recompute from stale rows.
    await ctx.sql
      .prepare(
        `UPDATE mail_messages SET unread = ?
          WHERE workspace_id = ? AND thread_id IN (${ids.map(() => '?').join(', ')})`,
      )
      .bind(patch.unread ? 1 : 0, ctx.workspace.id, ...ids)
      .run()
    sets.push('unread_count = ?')
    params.push(patch.unread ? 1 : 0)
  }
  if (patch.starred !== undefined) {
    sets.push('starred = ?')
    params.push(patch.starred ? 1 : 0)
  }
  if (patch.folder !== undefined) {
    sets.push('folder = ?')
    params.push(patch.folder)
  }
  if (patch.labels !== undefined) {
    sets.push('labels = ?')
    params.push(JSON.stringify(patch.labels))
  }
  if (patch.snoozed_until !== undefined) {
    sets.push('snoozed_until = ?')
    params.push(patch.snoozed_until)
  }
  if (sets.length === 0) return

  sets.push('updated_at = ?')
  params.push(new Date().toISOString())

  await ctx.sql
    .prepare(
      `UPDATE mail_threads SET ${sets.join(', ')}
        WHERE workspace_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
    )
    .bind(...params, ctx.workspace.id, ...ids)
    .run()

  // The mailbox actor holds its own read flag and backs the MCP tools; leaving
  // it behind would make an agent report unread mail a human has already read.
  if (patch.unread !== undefined) {
    const { doName } = await import('@mailysend/core')
    const rows = await ctx.sql
      .prepare(
        `SELECT id, mailbox_id FROM mail_threads
          WHERE workspace_id = ? AND mailbox_id IS NOT NULL
            AND id IN (${ids.map(() => '?').join(', ')})`,
      )
      .bind(ctx.workspace.id, ...ids)
      .all<{ id: string; mailbox_id: string }>()
    for (const row of rows.results) {
      ctx.background(
        ctx.env.MAILBOX.get(doName('Mailbox', ctx.workspace.id, row.mailbox_id)).markRead(
          row.id,
          !patch.unread,
        ),
      )
    }
  }
}

export { mail }
