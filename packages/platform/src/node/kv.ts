import type { DatabaseSync } from 'node:sqlite'
import type { Kv, KvPutOptions } from '../types.ts'

/**
 * `Kv` over a SQLite table.
 *
 * KV's role in MailySend is a hot read cache on the send path (API keys,
 * workspace config and — the one that must be sub-millisecond — the suppression
 * list, which is read for every single recipient). On Node the same table lives
 * in the app database, so that read is a local B-tree lookup rather than a
 * network hop, which is strictly better than the Workers case.
 *
 * Expiry is lazy: rows are filtered on read and swept on a timer, matching KV's
 * own eventually-consistent expiry rather than pretending to be stricter.
 */
export class NodeKv implements Kv {
  #db: DatabaseSync
  #table: string

  constructor(db: DatabaseSync, namespace: string) {
    this.#db = db
    this.#table = `kv_${namespace.replace(/[^a-z0-9_]/gi, '_')}`
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.#table} (
        k TEXT PRIMARY KEY,
        v BLOB NOT NULL,
        meta TEXT,
        expires_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS ${this.#table}_exp ON ${this.#table}(expires_at)
        WHERE expires_at IS NOT NULL;
    `)
  }

  async get(key: string, type: 'text' | 'json' = 'text'): Promise<any> {
    const row = this.#db.prepare(`SELECT v, expires_at FROM ${this.#table} WHERE k = ?`).get(key) as
      | { v: Uint8Array | string; expires_at: number | null }
      | undefined
    if (!row) return null
    if (row.expires_at !== null && row.expires_at <= Date.now()) {
      this.#db.prepare(`DELETE FROM ${this.#table} WHERE k = ?`).run(key)
      return null
    }
    const text = typeof row.v === 'string' ? row.v : new TextDecoder().decode(row.v)
    if (type === 'json') {
      try {
        return JSON.parse(text)
      } catch {
        return null
      }
    }
    return text
  }

  async put(key: string, value: string | ArrayBuffer | ReadableStream, options: KvPutOptions = {}) {
    let stored: string
    if (typeof value === 'string') stored = value
    else if (value instanceof ArrayBuffer) stored = new TextDecoder().decode(value)
    else stored = await new Response(value as ReadableStream).text()

    const expiresAt = options.expirationTtl
      ? Date.now() + options.expirationTtl * 1000
      : options.expiration
        ? options.expiration * 1000
        : null

    this.#db
      .prepare(
        `INSERT INTO ${this.#table} (k, v, meta, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(k) DO UPDATE SET v = excluded.v, meta = excluded.meta, expires_at = excluded.expires_at`,
      )
      .run(key, stored, options.metadata ? JSON.stringify(options.metadata) : null, expiresAt)
  }

  async delete(key: string) {
    this.#db.prepare(`DELETE FROM ${this.#table} WHERE k = ?`).run(key)
  }

  async list(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const limit = Math.min(options.limit ?? 1000, 1000)
    const after = options.cursor ? Buffer.from(options.cursor, 'base64url').toString() : ''
    const rows = this.#db
      .prepare(
        `SELECT k, meta, expires_at FROM ${this.#table}
         WHERE k GLOB ? AND k > ? AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY k LIMIT ?`,
      )
      .all(`${options.prefix ?? ''}*`, after, Date.now(), limit + 1) as {
      k: string
      meta: string | null
      expires_at: number | null
    }[]

    const page = rows.slice(0, limit)
    const complete = rows.length <= limit
    return {
      keys: page.map((r) => ({
        name: r.k,
        ...(r.expires_at ? { expiration: Math.floor(r.expires_at / 1000) } : {}),
        ...(r.meta ? { metadata: JSON.parse(r.meta) as Record<string, unknown> } : {}),
      })),
      list_complete: complete,
      ...(complete ? {} : { cursor: Buffer.from(page.at(-1)!.k).toString('base64url') }),
    }
  }

  /** Called on a timer by the Node runtime so expired rows do not accumulate. */
  sweep(): number {
    const res = this.#db.prepare(`DELETE FROM ${this.#table} WHERE expires_at <= ?`).run(Date.now())
    return Number(res.changes ?? 0)
  }
}
