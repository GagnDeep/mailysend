import { newId } from '@mailysend/core'
import type { Sql, SqlStatement } from '@mailysend/platform'

/**
 * The mail index — one conversation model, written from both directions.
 *
 * Every path that produces a message goes through here: the inbound consumer,
 * the accept path, the send consumer's status writes and the test-mode
 * loopback. That is deliberate. The previous arrangement had received mail
 * written in one place, sent mail in another, and a thread table that nothing
 * wrote at all — so the inbox was structurally empty and a reply was never
 * attached to the message it answered.
 *
 * Nothing here stores a body. Bodies, attachments and the original MIME stay in
 * object storage; these rows are what a list, a search and a threading decision
 * need.
 */

export type Direction = 'in' | 'out'
export type Environment = 'live' | 'test'
export type Folder = 'inbox' | 'sent' | 'archive' | 'spam' | 'trash'

export interface MailAttachmentInput {
  filename: string
  contentType: string
  size: number
  contentId?: string | null
  inline?: boolean
  blobKey: string
}

export interface MailMessageInput {
  id: string
  workspaceId: string
  threadId: string
  direction: Direction
  environment: Environment
  mailboxId?: string | null
  /** `inbound_messages.id` or `messages.id` — the row that owns delivery facts. */
  sourceId?: string | null
  messageIdHeader?: string | null
  inReplyTo?: string | null
  references?: string[]
  fromAddress: string
  fromName?: string | null
  to: string[]
  cc?: string[]
  bcc?: string[]
  replyTo?: string | null
  subject: string
  snippet: string
  sizeBytes?: number | null
  bodyKey?: string | null
  rawKey?: string | null
  spf?: string | null
  dkim?: string | null
  dmarc?: string | null
  spamScore?: number | null
  parseStatus?: string
  matchedBy?: string | null
  /** Outbound only, mirrored from `messages.status`. */
  status?: string | null
  at: string
  attachments?: MailAttachmentInput[]
  /** Inbound arrives unread; a message we sent never does. */
  unread?: boolean
}

export interface MailThreadInput {
  id: string
  workspaceId: string
  mailboxId?: string | null
  environment: Environment
  subject: string
  subjectNormalized: string
  participants: string[]
  folder: Folder
  lastMessageAt: string
  lastDirection: Direction
  snippet: string
  hasAttachments: boolean
  unreadDelta: number
}

/** Strips every `Re:`/`Fwd:` prefix, including the localised ones people send. */
export const normalizeSubject = (subject: string): string =>
  subject
    .replace(/^(\s*(re|aw|fwd?|fw|sv|vs|antw|res|rif)\s*(\[\d+\])?\s*:\s*)+/i, '')
    .trim()
    .toLowerCase()

export const stripTags = (html: string): string =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export const snippetOf = (text: string | null | undefined, html?: string | null): string =>
  (text?.trim() ? text : stripTags(html ?? '')).slice(0, 500)

/** `thr+<token>@…` — the address a threaded reply is invited to come back to. */
export const replyAddress = (token: string, domain: string): string => `thr+${token}@${domain}`

/**
 * Threading in SQL.
 *
 * The mailbox actor remains the oracle for mail that arrives over SMTP — it
 * holds the subject/participant heuristics and the confidence chain. This is
 * the narrower version used where there is no mailbox actor to ask: an
 * outbound message being filed at accept time, and the test-mode loopback.
 * Header matching only, because guessing is the actor's job.
 */
export async function resolveThreadBySql(
  sql: Sql,
  workspaceId: string,
  input: { inReplyTo?: string | null; references?: string[] },
): Promise<{ threadId: string | null; matchedBy: string }> {
  const candidates = [input.inReplyTo, ...(input.references ?? []).slice().reverse()].filter(
    (value): value is string => Boolean(value),
  )
  for (const [index, header] of candidates.entries()) {
    const found = await sql
      .prepare(
        'SELECT thread_id FROM mail_messages WHERE workspace_id = ? AND message_id_header = ? LIMIT 1',
      )
      .bind(workspaceId, header)
      .first<{ thread_id: string }>()
    if (found) {
      return { threadId: found.thread_id, matchedBy: index === 0 ? 'in_reply_to' : 'references' }
    }
  }
  return { threadId: null, matchedBy: 'new' }
}

/**
 * Writes one message into the conversation model.
 *
 * Returns `false` when the message was already there. The queue is
 * at-least-once and the loopback can race a real delivery of the same
 * Message-ID, so "already recorded" has to be an ordinary answer rather than a
 * conflict — and the thread counters must not advance for a message that was
 * not actually added.
 */
export async function writeMailMessage(
  sql: Sql,
  message: MailMessageInput,
  thread: Omit<MailThreadInput, 'unreadDelta'>,
): Promise<boolean> {
  const inserted = await sql
    .prepare(
      `INSERT INTO mail_messages (
         id, workspace_id, thread_id, direction, environment, mailbox_id, source_id,
         message_id_header, in_reply_to, references_json, from_address, from_name,
         to_addresses, cc_addresses, bcc_addresses, reply_to, subject, snippet,
         has_attachments, unread, size_bytes, body_key, raw_key, spf, dkim, dmarc,
         spam_score, parse_status, matched_by, status, at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT DO NOTHING`,
    )
    .bind(
      message.id,
      message.workspaceId,
      message.threadId,
      message.direction,
      message.environment,
      message.mailboxId ?? null,
      message.sourceId ?? null,
      message.messageIdHeader ?? null,
      message.inReplyTo ?? null,
      message.references?.length ? JSON.stringify(message.references) : null,
      message.fromAddress,
      message.fromName ?? null,
      JSON.stringify(message.to),
      message.cc?.length ? JSON.stringify(message.cc) : null,
      message.bcc?.length ? JSON.stringify(message.bcc) : null,
      message.replyTo ?? null,
      message.subject,
      message.snippet,
      message.attachments?.length ? 1 : 0,
      (message.unread ?? message.direction === 'in') ? 1 : 0,
      message.sizeBytes ?? null,
      message.bodyKey ?? null,
      message.rawKey ?? null,
      message.spf ?? null,
      message.dkim ?? null,
      message.dmarc ?? null,
      message.spamScore ?? null,
      message.parseStatus ?? 'parsed',
      message.matchedBy ?? null,
      message.status ?? null,
      message.at,
    )
    .run()

  if (inserted.meta.changes === 0) return false

  const statements: SqlStatement[] = [
    upsertThreadStatement(sql, {
      ...thread,
      hasAttachments: thread.hasAttachments || Boolean(message.attachments?.length),
      unreadDelta: (message.unread ?? message.direction === 'in') ? 1 : 0,
    }),
    indexSearchStatement(sql, message),
  ]

  for (const attachment of message.attachments ?? []) {
    statements.push(
      sql
        .prepare(
          `INSERT INTO mail_attachments
             (id, workspace_id, message_id, thread_id, filename, content_type, size,
              content_id, inline, blob_key, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          newId('attachment'),
          message.workspaceId,
          message.id,
          message.threadId,
          attachment.filename,
          attachment.contentType,
          attachment.size,
          attachment.contentId ?? null,
          attachment.inline || attachment.contentId ? 1 : 0,
          attachment.blobKey,
          message.at,
        ),
    )
  }

  await sql.batch(statements)
  return true
}

/**
 * The thread aggregate.
 *
 * `folder` is the interesting column. A reply arriving on an archived thread
 * pulls it back to the inbox, exactly as every mail client does — but a thread
 * in the trash stays in the trash, because otherwise deleting a conversation
 * with a persistent sender would never take.
 */
function upsertThreadStatement(sql: Sql, thread: MailThreadInput): SqlStatement {
  const now = new Date().toISOString()
  return sql
    .prepare(
      `INSERT INTO mail_threads (
         id, workspace_id, mailbox_id, environment, subject, subject_normalized, participants,
         message_count, unread_count, has_attachments, starred, folder, labels,
         snoozed_until, last_message_at, last_direction, snippet, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,1,?,?,0,?,NULL,NULL,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         message_count  = message_count + 1,
         unread_count   = unread_count + excluded.unread_count,
         has_attachments = MAX(has_attachments, excluded.has_attachments),
         participants   = excluded.participants,
         mailbox_id     = COALESCE(mail_threads.mailbox_id, excluded.mailbox_id),
         last_message_at = MAX(last_message_at, excluded.last_message_at),
         last_direction = excluded.last_direction,
         snippet        = excluded.snippet,
         snoozed_until  = NULL,
         folder = CASE
           WHEN mail_threads.folder = 'trash' THEN 'trash'
           WHEN excluded.last_direction = 'in' THEN 'inbox'
           ELSE mail_threads.folder END,
         updated_at     = excluded.updated_at`,
    )
    .bind(
      thread.id,
      thread.workspaceId,
      thread.mailboxId ?? null,
      thread.environment,
      thread.subject,
      thread.subjectNormalized,
      JSON.stringify([...new Set(thread.participants.map((p) => p.toLowerCase()))]),
      thread.unreadDelta,
      thread.hasAttachments ? 1 : 0,
      thread.folder,
      thread.lastMessageAt,
      thread.lastDirection,
      thread.snippet.slice(0, 500),
      now,
      now,
    )
}

function indexSearchStatement(sql: Sql, message: MailMessageInput): SqlStatement {
  return sql
    .prepare(
      `INSERT INTO mail_search
         (message_id, thread_id, workspace_id, environment, subject, snippet, from_address, to_addresses)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .bind(
      message.id,
      message.threadId,
      message.workspaceId,
      message.environment,
      message.subject,
      message.snippet,
      message.fromAddress,
      message.to.join(' '),
    )
}

/**
 * Mirrors an outbound message's delivery state onto its conversation row.
 *
 * This is what lets the reading pane show queued → sent → delivered → opened
 * inline on a message you sent, which is the one thing a mail client cannot do
 * and the reason this surface is worth building inside a sending platform.
 */
export async function updateOutboundStatus(
  sql: Sql,
  workspaceId: string,
  emailId: string,
  status: string,
): Promise<void> {
  await sql
    .prepare(
      `UPDATE mail_messages SET status = ?
        WHERE workspace_id = ? AND direction = 'out' AND source_id = ?`,
    )
    .bind(status, workspaceId, emailId)
    .run()
}

/** Removes a thread's rows from the index. Bodies are deleted by the caller. */
export async function deleteThreadRows(
  sql: Sql,
  workspaceId: string,
  threadId: string,
): Promise<void> {
  await sql.batch([
    sql
      .prepare('DELETE FROM mail_search WHERE workspace_id = ? AND thread_id = ?')
      .bind(workspaceId, threadId),
    sql
      .prepare('DELETE FROM mail_attachments WHERE workspace_id = ? AND thread_id = ?')
      .bind(workspaceId, threadId),
    sql
      .prepare('DELETE FROM mail_messages WHERE workspace_id = ? AND thread_id = ?')
      .bind(workspaceId, threadId),
    sql
      .prepare('DELETE FROM mail_threads WHERE workspace_id = ? AND id = ?')
      .bind(workspaceId, threadId),
  ])
}
