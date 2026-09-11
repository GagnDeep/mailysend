import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { bool, createdAt, json, updatedAt, workspaceId } from './_shared.ts'

/**
 * Mail — one conversation model for both directions.
 *
 * `inbound_threads` recorded received mail only, and nothing ever wrote to it.
 * A message we sent and the reply it earned lived in two tables that shared no
 * key, so the product could show you a sent log and a received log and never
 * the conversation between them. These tables are the conversation.
 *
 * They are an *index*, not a store: bodies, attachments and the original MIME
 * stay in object storage exactly as before. What lives here is what a list, a
 * search and a threading decision need, which is what keeps a mailbox with a
 * decade of mail in it fast on D1.
 */

export const mailThreads = sqliteTable(
  'mail_threads',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    /** Null for a thread that only ever went outbound — there is no mailbox yet. */
    mailboxId: text('mailbox_id'),
    /** `test` threads are the loopback inbox; they never touched a provider. */
    environment: text('environment', { enum: ['live', 'test'] })
      .notNull()
      .default('live'),
    subject: text('subject').notNull(),
    /** Re:/Fwd: stripped and lowercased — the last-resort threading match. */
    subjectNormalized: text('subject_normalized').notNull(),
    participants: json('participants').notNull(),
    messageCount: integer('message_count').notNull().default(0),
    unreadCount: integer('unread_count').notNull().default(0),
    hasAttachments: bool('has_attachments').notNull().default(false),
    starred: bool('starred').notNull().default(false),
    folder: text('folder', { enum: ['inbox', 'sent', 'archive', 'spam', 'trash'] })
      .notNull()
      .default('inbox'),
    /** Label ids, as JSON. A thread carries labels; a message never does. */
    labels: json('labels'),
    snoozedUntil: text('snoozed_until'),
    lastMessageAt: text('last_message_at').notNull(),
    lastDirection: text('last_direction', { enum: ['in', 'out'] })
      .notNull()
      .default('in'),
    snippet: text('snippet').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('mail_threads_folder').on(t.workspaceId, t.environment, t.folder, t.lastMessageAt),
    index('mail_threads_subject').on(t.workspaceId, t.subjectNormalized, t.lastMessageAt),
    index('mail_threads_snoozed').on(t.snoozedUntil),
  ],
)

/**
 * Every message in a conversation, in either direction.
 *
 * `source_id` points back at the row that owns the delivery facts —
 * `inbound_messages.id` for received mail, `messages.id` for sent — so this
 * table never becomes a second, diverging copy of either. The reading pane
 * joins through it to show a sent message's live delivery state inline.
 */
export const mailMessages = sqliteTable(
  'mail_messages',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    threadId: text('thread_id').notNull(),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    environment: text('environment', { enum: ['live', 'test'] })
      .notNull()
      .default('live'),
    mailboxId: text('mailbox_id'),
    sourceId: text('source_id'),
    messageIdHeader: text('message_id_header'),
    inReplyTo: text('in_reply_to'),
    referencesJson: json('references_json'),
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name'),
    toAddresses: json('to_addresses').notNull(),
    ccAddresses: json('cc_addresses'),
    bccAddresses: json('bcc_addresses'),
    replyTo: text('reply_to'),
    subject: text('subject').notNull(),
    snippet: text('snippet').notNull().default(''),
    hasAttachments: bool('has_attachments').notNull().default(false),
    unread: bool('unread').notNull().default(false),
    sizeBytes: integer('size_bytes'),
    bodyKey: text('body_key'),
    rawKey: text('raw_key'),
    spf: text('spf'),
    dkim: text('dkim'),
    dmarc: text('dmarc'),
    spamScore: integer('spam_score'),
    parseStatus: text('parse_status').notNull().default('parsed'),
    /** Which threading signal attached this message. Surfaced in the reader. */
    matchedBy: text('matched_by'),
    /** Outbound only: mirrors `messages.status` so the list needs no join. */
    status: text('status'),
    at: text('at').notNull(),
  },
  (t) => [
    index('mail_messages_thread').on(t.workspaceId, t.threadId, t.at),
    // Two copies of the same Message-ID are the same message however it reached
    // us — a loopback send that also arrives inbound must not appear twice.
    uniqueIndex('mail_messages_header').on(t.workspaceId, t.messageIdHeader),
    index('mail_messages_source').on(t.workspaceId, t.sourceId),
    // "Has mail ever arrived for this domain" is a lookup by mailbox, which the
    // domain page asks on every load. Without this it is a table scan.
    index('mail_messages_mailbox').on(t.workspaceId, t.mailboxId, t.at),
  ],
)

/**
 * Attachment metadata.
 *
 * The bytes were already being written to R2; without this table there was no
 * key anywhere in SQL and no route, so every attachment ever received was
 * unreachable. That is the whole reason this table exists.
 */
export const mailAttachments = sqliteTable(
  'mail_attachments',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    messageId: text('message_id').notNull(),
    threadId: text('thread_id').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull().default(0),
    /** Set for `cid:` images referenced from the HTML body. */
    contentId: text('content_id'),
    inline: bool('inline').notNull().default(false),
    blobKey: text('blob_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('mail_attachments_message').on(t.workspaceId, t.messageId)],
)

export const mailDrafts = sqliteTable(
  'mail_drafts',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    userId: text('user_id'),
    threadId: text('thread_id'),
    /** `reply`, `reply_all`, `forward` or `new` — decides the quoted preamble. */
    mode: text('mode').notNull().default('new'),
    environment: text('environment', { enum: ['live', 'test'] })
      .notNull()
      .default('live'),
    fromAddress: text('from_address'),
    toAddresses: json('to_addresses'),
    ccAddresses: json('cc_addresses'),
    bccAddresses: json('bcc_addresses'),
    subject: text('subject'),
    html: text('html'),
    text: text('text'),
    inReplyTo: text('in_reply_to'),
    referencesJson: json('references_json'),
    attachments: json('attachments'),
    scheduledAt: text('scheduled_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('mail_drafts_ws').on(t.workspaceId, t.updatedAt)],
)

export const mailLabels = sqliteTable(
  'mail_labels',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    name: text('name').notNull(),
    /** A design-token name, not a hex value — the palette stays the palette. */
    colour: text('colour').notNull().default('neutral'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('mail_labels_name').on(t.workspaceId, t.name)],
)
