import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { Sql, SqlMeta, SqlStatement } from '../types.ts'

/**
 * `Sql` over `node:sqlite`.
 *
 * `node:sqlite` ships with Node ≥22 and needs no native build step, which
 * matters: the ARM deployment target should not require a compiler toolchain
 * to install a database driver.
 *
 * D1 is itself SQLite, so the dialect is identical and one migration set covers
 * both runtimes. The only real difference is that D1's API is async and
 * `node:sqlite`'s is sync; we wrap in resolved promises rather than pretending
 * to do I/O.
 */

const emptyMeta = (over: Partial<SqlMeta> = {}): SqlMeta => ({
  duration: 0,
  rows_read: 0,
  rows_written: 0,
  last_row_id: 0,
  changes: 0,
  ...over,
})

/** SQLite returns null-prototype rows; JSON.stringify and spread behave oddly on them. */
const plain = <T>(row: unknown): T => ({ ...(row as object) }) as T

class NodeStatement implements SqlStatement {
  #db: DatabaseSync
  #query: string
  #bindings: unknown[]
  #cached?: StatementSync

  constructor(db: DatabaseSync, query: string, bindings: unknown[] = []) {
    this.#db = db
    this.#query = query
    this.#bindings = bindings
  }

  get query() {
    return this.#query
  }

  get bindings() {
    return this.#bindings
  }

  bind(...values: unknown[]): SqlStatement {
    return new NodeStatement(this.#db, this.#query, values)
  }

  #stmt(): StatementSync {
    if (!this.#cached) this.#cached = this.#db.prepare(this.#query)
    return this.#cached
  }

  /**
   * SQLite accepts null, number, bigint, string and Uint8Array only. Booleans
   * and Dates arrive constantly from application code; coercing here means no
   * caller has to remember, and the coercion is identical to what D1 does.
   */
  #args(): unknown[] {
    return this.#bindings.map((v) => {
      if (v === undefined || v === null) return null
      if (typeof v === 'boolean') return v ? 1 : 0
      if (v instanceof Date) return v.toISOString()
      if (typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v)
      return v
    })
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<any> {
    const started = performance.now()
    const row = this.#stmt().get(...(this.#args() as never[]))
    if (row === undefined) return null
    const obj = plain<Record<string, unknown>>(row)
    void started
    return column ? ((obj[column] ?? null) as T) : (obj as T)
  }

  async all<T = Record<string, unknown>>() {
    const started = performance.now()
    const rows = this.#stmt().all(...(this.#args() as never[]))
    return {
      results: rows.map((r) => plain<T>(r)),
      success: true,
      meta: emptyMeta({ duration: performance.now() - started, rows_read: rows.length }),
    }
  }

  async run() {
    const started = performance.now()
    const res = this.#stmt().run(...(this.#args() as never[]))
    return {
      success: true,
      meta: emptyMeta({
        duration: performance.now() - started,
        rows_written: Number(res.changes ?? 0),
        changes: Number(res.changes ?? 0),
        last_row_id: Number(res.lastInsertRowid ?? 0),
      }),
    }
  }
}

export class NodeSql implements Sql {
  readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    // WAL keeps readers from blocking the single writer, which is what makes a
    // one-process deployment survive a broadcast running alongside dashboard
    // traffic. The rest are the standard durability/latency trade-offs for a
    // server-resident database.
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
  }

  prepare(query: string): SqlStatement {
    return new NodeStatement(this.db, query)
  }

  async batch<T = unknown>(statements: SqlStatement[]) {
    // D1's batch is atomic. Ours must be too, or the event consumer's
    // "6 writes as one unit" guarantee silently degrades on Node.
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const out = []
      for (const st of statements) out.push(await st.all<T>())
      this.db.exec('COMMIT')
      return out
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  async exec(query: string) {
    const started = performance.now()
    this.db.exec(query)
    return { count: 1, duration: performance.now() - started }
  }

  close() {
    this.db.close()
  }
}
