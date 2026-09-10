import { Actor } from './base.ts'

/**
 * One actor per inbound mailbox.
 *
 * Threads, headers and short snippets live in the actor's own SQLite, with an
 * FTS5 index over subject and snippet. Bodies and attachments stay in object
 * storage — a mailbox is comfortably inside the 10 GB per-object limit as long
 * as it never stores a message body, and it never does.
 *
 * The FTS index is what makes the MCP `search_threads` tool answer in a single
 * hop, which matters because an agent asking "what did this customer say about
 * refunds?" should not turn into a table scan.
 */

export interface ThreadRow {
  id: string
  subject: string
  subject_normalized: string
  participants: string
  message_count: number
  unread: number
  last_message_at: string
  created_at: string
}

export interface MessageRow {
  id: string
  thread_id: string
  from_address: string
  subject: string
  snippet: string
  message_id_header: string | null
  in_reply_to: string | null
  received_at: string
  matched_by: string | null
}

export class MailboxActor extends Actor {
  #ready = false

  async #init() {
    if (this.#ready) return
    const sql = this.storage.sql
    if (!sql) throw new Error('MailboxActor requires SQLite-backed storage')

    sql.exec(`CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      subject_normalized TEXT NOT NULL,
      participants TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      unread INTEGER NOT NULL DEFAULT 1,
      last_message_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`)
    sql.exec(`CREATE INDEX IF NOT EXISTS threads_recent ON threads(last_message_at DESC)`)
    sql.exec(
      `CREATE INDEX IF NOT EXISTS threads_subject ON threads(subject_normalized, last_message_at DESC)`,
    )

    sql.exec(`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      from_address TEXT NOT NULL,
      subject TEXT NOT NULL,
      snippet TEXT NOT NULL,
      message_id_header TEXT,
      in_reply_to TEXT,
      received_at TEXT NOT NULL,
      matched_by TEXT
    )`)
    sql.exec(`CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id, received_at)`)
    sql.exec(`CREATE INDEX IF NOT EXISTS messages_header ON messages(message_id_header)`)

    // `content=''` makes this a contentless FTS table: it stores only the index,
    // not a second copy of the text, which keeps the mailbox small.
    sql.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(
      subject, snippet, from_address, content='', tokenize='porter unicode61'
    )`)

    this.#ready = true
  }

  /**
   * Threading, resolved in descending confidence.
   *
   * Order matters: mail clients mangle References headers and rewrite subject
   * lines, but they preserve the address they were told to reply to — so a
   * signed reply token beats every RFC header. An invalid token never drops
   * mail; it falls through to the next signal, and the message is flagged so
   * the dashboard can show that threading was uncertain.
   */
  async resolveThread(input: {
    replyTokenThreadId?: string | null
    inReplyTo?: string | null
    references?: string[]
    subjectNormalized: string
    participants: string[]
    receivedAt: string
  }): Promise<{ threadId: string | null; matchedBy: string }> {
    await this.#init()
    const sql = this.storage.sql!

    if (input.replyTokenThreadId) {
      const found = sql
        .exec<{ id: string }>('SELECT id FROM threads WHERE id = ?', input.replyTokenThreadId)
        .toArray()
      if (found.length > 0) return { threadId: found[0]!.id, matchedBy: 'reply_token' }
    }

    if (input.inReplyTo) {
      const found = sql
        .exec<{ thread_id: string }>(
          'SELECT thread_id FROM messages WHERE message_id_header = ? LIMIT 1',
          input.inReplyTo,
        )
        .toArray()
      if (found.length > 0) return { threadId: found[0]!.thread_id, matchedBy: 'in_reply_to' }
    }

    for (const ref of (input.references ?? []).slice().reverse()) {
      const found = sql
        .exec<{ thread_id: string }>(
          'SELECT thread_id FROM messages WHERE message_id_header = ? LIMIT 1',
          ref,
        )
        .toArray()
      if (found.length > 0) return { threadId: found[0]!.thread_id, matchedBy: 'references' }
    }

    // Last resort: same normalised subject, overlapping participants, within a
    // week. Beyond a week the false-positive rate on generic subjects ("Re:
    // invoice") gets high enough that a new thread is the better answer.
    const weekAgo = new Date(new Date(input.receivedAt).getTime() - 7 * 86_400_000).toISOString()
    const candidates = sql
      .exec<ThreadRow>(
        'SELECT * FROM threads WHERE subject_normalized = ? AND last_message_at > ? ORDER BY last_message_at DESC LIMIT 5',
        input.subjectNormalized,
        weekAgo,
      )
      .toArray()
    for (const candidate of candidates) {
      const existing: string[] = JSON.parse(candidate.participants)
      if (input.participants.some((p) => existing.includes(p.toLowerCase()))) {
        return { threadId: candidate.id, matchedBy: 'subject_participants' }
      }
    }

    return { threadId: null, matchedBy: 'new' }
  }

  async appendMessage(input: {
    threadId: string
    message: MessageRow
    subject: string
    subjectNormalized: string
    participants: string[]
  }): Promise<void> {
    await this.#init()
    const sql = this.storage.sql!

    sql.exec(
      `INSERT INTO threads (id, subject, subject_normalized, participants, message_count, unread, last_message_at, created_at)
       VALUES (?, ?, ?, ?, 1, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         message_count = message_count + 1,
         unread = 1,
         last_message_at = MAX(last_message_at, excluded.last_message_at),
         participants = excluded.participants`,
      input.threadId,
      input.subject,
      input.subjectNormalized,
      JSON.stringify([...new Set(input.participants.map((p) => p.toLowerCase()))]),
      input.message.received_at,
      new Date().toISOString(),
    )

    sql.exec(
      `INSERT OR IGNORE INTO messages
         (id, thread_id, from_address, subject, snippet, message_id_header, in_reply_to, received_at, matched_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.message.id,
      input.threadId,
      input.message.from_address,
      input.message.subject,
      input.message.snippet,
      input.message.message_id_header ?? null,
      input.message.in_reply_to ?? null,
      input.message.received_at,
      input.message.matched_by ?? null,
    )

    sql.exec(
      'INSERT INTO search (rowid, subject, snippet, from_address) VALUES ((SELECT rowid FROM messages WHERE id = ?), ?, ?, ?)',
      input.message.id,
      input.message.subject,
      input.message.snippet,
      input.message.from_address,
    )
  }

  async listThreads(
    options: { limit?: number; before?: string; unreadOnly?: boolean } = {},
  ): Promise<ThreadRow[]> {
    await this.#init()
    const sql = this.storage.sql!
    const limit = Math.min(options.limit ?? 25, 100)
    const clauses: string[] = []
    const args: unknown[] = []
    if (options.before) {
      clauses.push('last_message_at < ?')
      args.push(options.before)
    }
    if (options.unreadOnly) clauses.push('unread = 1')
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    return sql
      .exec<ThreadRow>(
        `SELECT * FROM threads ${where} ORDER BY last_message_at DESC LIMIT ?`,
        ...args,
        limit,
      )
      .toArray()
  }

  async getThread(threadId: string): Promise<{ thread: ThreadRow | null; messages: MessageRow[] }> {
    await this.#init()
    const sql = this.storage.sql!
    const thread =
      sql.exec<ThreadRow>('SELECT * FROM threads WHERE id = ?', threadId).toArray()[0] ?? null
    const messages = sql
      .exec<MessageRow>('SELECT * FROM messages WHERE thread_id = ? ORDER BY received_at', threadId)
      .toArray()
    return { thread, messages }
  }

  /** Backs the MCP `search_threads` tool. */
  async search(query: string, limit = 20): Promise<MessageRow[]> {
    await this.#init()
    const sql = this.storage.sql!
    // FTS5 treats several punctuation characters as operators; quoting the
    // whole query makes user input a literal phrase rather than a syntax error.
    const safe = `"${query.replace(/"/g, '""')}"`
    return sql
      .exec<MessageRow>(
        `SELECT m.* FROM search s JOIN messages m ON m.rowid = s.rowid
         WHERE search MATCH ? ORDER BY rank LIMIT ?`,
        safe,
        Math.min(limit, 50),
      )
      .toArray()
  }

  async markRead(threadId: string, read = true): Promise<void> {
    await this.#init()
    this.storage.sql!.exec('UPDATE threads SET unread = ? WHERE id = ?', read ? 0 : 1, threadId)
  }

  async stats(): Promise<{ threads: number; messages: number; unread: number }> {
    await this.#init()
    const sql = this.storage.sql!
    const row = sql
      .exec<{ threads: number; messages: number; unread: number }>(
        `SELECT (SELECT COUNT(*) FROM threads) AS threads,
                (SELECT COUNT(*) FROM messages) AS messages,
                (SELECT COUNT(*) FROM threads WHERE unread = 1) AS unread`,
      )
      .toArray()[0]!
    return row
  }
}
