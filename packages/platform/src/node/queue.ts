import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Queue, QueueBatch, QueueHandler, QueueMessage, QueueSendOptions } from '../types.ts'

interface Row {
  id: string
  queue: string
  body: string
  visible_at: number
  attempts: number
  created_at: number
}

/**
 * Cloudflare Queues over one SQLite table plus a poller.
 *
 * The semantics that matter to the code above are: at-least-once delivery,
 * per-message ack/retry, delayed visibility, batching, and a dead-letter path
 * after a bounded number of attempts. All five are reproducible with a
 * `visible_at` column and a transactional claim, which is what this is.
 *
 * Note the deliberate absence of any ordering guarantee, matching Queues. The
 * event pipeline's monotonic state ladder means ordering is not needed, and
 * promising it here would let ordering-dependent code creep in that then breaks
 * on Workers.
 */
export class NodeQueueBroker {
  #db: DatabaseSync
  #handlers = new Map<
    string,
    { handler: QueueHandler<any>; maxBatch: number; maxRetries: number; dlq?: string }
  >()
  #timer?: NodeJS.Timeout
  #running = false
  #env: unknown

  constructor(db: DatabaseSync, env: unknown) {
    this.#db = db
    this.#env = env
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS queue_messages (
        id TEXT PRIMARY KEY,
        queue TEXT NOT NULL,
        body TEXT NOT NULL,
        visible_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        claimed_until INTEGER
      );
      CREATE INDEX IF NOT EXISTS queue_messages_ready
        ON queue_messages(queue, visible_at);
    `)
  }

  producer<T>(queue: string): Queue<T> {
    const db = this.#db
    const insert = (body: T, delaySeconds = 0) => {
      db.prepare(
        `INSERT INTO queue_messages (id, queue, body, visible_at, attempts, created_at)
         VALUES (?, ?, ?, ?, 0, ?)`,
      ).run(
        randomUUID(),
        queue,
        JSON.stringify(body ?? null),
        Date.now() + delaySeconds * 1000,
        Date.now(),
      )
    }
    return {
      async send(body: T, options: QueueSendOptions = {}) {
        insert(body, options.delaySeconds)
      },
      async sendBatch(messages, options = {}) {
        db.exec('BEGIN IMMEDIATE')
        try {
          for (const m of messages) insert(m.body, m.delaySeconds ?? options.delaySeconds)
          db.exec('COMMIT')
        } catch (err) {
          db.exec('ROLLBACK')
          throw err
        }
      },
    }
  }

  consumer<T>(
    queue: string,
    handler: QueueHandler<T>,
    options: { maxBatch?: number; maxRetries?: number; deadLetterQueue?: string } = {},
  ) {
    this.#handlers.set(queue, {
      handler,
      maxBatch: options.maxBatch ?? 100,
      maxRetries: options.maxRetries ?? 5,
      dlq: options.deadLetterQueue,
    })
  }

  start(intervalMs = 250) {
    if (this.#timer) return
    this.#timer = setInterval(() => {
      void this.tick()
    }, intervalMs)
    // A poller must never keep the process alive on its own; shutdown should be
    // decided by the HTTP server, not by a 250 ms timer.
    this.#timer.unref?.()
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
  }

  /** One poll across every registered consumer. Exposed for tests. */
  async tick(): Promise<void> {
    if (this.#running) return
    this.#running = true
    try {
      for (const [queue, cfg] of this.#handlers) {
        const rows = this.#claim(queue, cfg.maxBatch)
        if (rows.length === 0) continue
        await this.#deliver(queue, rows, cfg)
      }
    } finally {
      this.#running = false
    }
  }

  /**
   * Claiming and delivering are separate transactions on purpose: a handler that
   * throws must leave its messages claimed-and-expiring rather than holding a
   * write lock for the duration of, say, an SMTP conversation.
   */
  #claim(queue: string, limit: number): Row[] {
    const now = Date.now()
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const rows = this.#db
        .prepare(
          `SELECT id, queue, body, visible_at, attempts, created_at FROM queue_messages
           WHERE queue = ? AND visible_at <= ? AND (claimed_until IS NULL OR claimed_until < ?)
           ORDER BY visible_at LIMIT ?`,
        )
        .all(queue, now, now, limit) as unknown as Row[]
      for (const r of rows) {
        this.#db
          .prepare(
            'UPDATE queue_messages SET claimed_until = ?, attempts = attempts + 1 WHERE id = ?',
          )
          .run(now + 120_000, r.id)
      }
      this.#db.exec('COMMIT')
      return rows
    } catch (err) {
      this.#db.exec('ROLLBACK')
      throw err
    }
  }

  async #deliver(
    queue: string,
    rows: Row[],
    cfg: { handler: QueueHandler<any>; maxRetries: number; dlq?: string },
  ) {
    const acked = new Set<string>()
    const retried = new Map<string, number>()

    const messages: QueueMessage<unknown>[] = rows.map((r) => ({
      id: r.id,
      timestamp: new Date(r.created_at),
      body: JSON.parse(r.body),
      attempts: r.attempts + 1,
      ack: () => void acked.add(r.id),
      retry: (o) => void retried.set(r.id, o?.delaySeconds ?? 0),
    }))

    const batch: QueueBatch<unknown> = {
      queue,
      messages,
      ackAll: () => {
        for (const m of messages) acked.add(m.id)
      },
      retryAll: (o) => {
        for (const m of messages) retried.set(m.id, o?.delaySeconds ?? 0)
      },
    }

    try {
      await cfg.handler(batch as never, this.#env)
    } catch (err) {
      // A handler that throws retries the whole batch, exactly as on Workers.
      console.error(`[queue:${queue}] handler threw`, err)
      batch.retryAll()
    }

    for (const m of messages) {
      if (retried.has(m.id)) {
        const delay = retried.get(m.id)!
        if (m.attempts >= cfg.maxRetries) {
          this.#deadLetter(m.id, cfg.dlq)
        } else {
          // Exponential backoff when the handler did not name a delay, so a
          // provider outage does not become a hot loop.
          const backoff = delay > 0 ? delay : Math.min(2 ** m.attempts, 900)
          this.#db
            .prepare('UPDATE queue_messages SET visible_at = ?, claimed_until = NULL WHERE id = ?')
            .run(Date.now() + backoff * 1000, m.id)
        }
      } else if (acked.has(m.id)) {
        this.#db.prepare('DELETE FROM queue_messages WHERE id = ?').run(m.id)
      } else {
        // Cloudflare implicitly acks anything the handler did not retry.
        this.#db.prepare('DELETE FROM queue_messages WHERE id = ?').run(m.id)
      }
    }
  }

  #deadLetter(id: string, dlq?: string) {
    if (dlq) {
      this.#db
        .prepare(
          'UPDATE queue_messages SET queue = ?, attempts = 0, claimed_until = NULL, visible_at = ? WHERE id = ?',
        )
        .run(dlq, Date.now(), id)
    } else {
      this.#db.prepare('DELETE FROM queue_messages WHERE id = ?').run(id)
    }
  }

  depth(queue: string): number {
    const row = this.#db
      .prepare('SELECT COUNT(*) AS n FROM queue_messages WHERE queue = ?')
      .get(queue) as {
      n: number
    }
    return Number(row?.n ?? 0)
  }
}
