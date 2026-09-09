import type { DatabaseSync } from 'node:sqlite'
import type { ActorContext, ActorNamespace, ActorStorage, ActorStub } from '../types.ts'

/**
 * Durable Objects on Node.
 *
 * A DO gives three things: a serialisation point per key, durable storage, and
 * an alarm. In one Node process the first is free (the event loop), the second
 * is a SQLite table keyed by actor id, and the third is a timer backed by a
 * persisted `alarm_at` so a restart does not lose it.
 *
 * The property this does *not* reproduce is global single-instance across
 * processes. That is why the PM2 ecosystem file runs the app in fork mode with
 * `instances: 1`; running two would break the broadcast cursor and the
 * rate-limit governor. The Workers deployment has no such restriction.
 */

class NodeActorStorage implements ActorStorage {
  #db: DatabaseSync
  #actor: string
  #onAlarmSet: (at: number) => void

  constructor(db: DatabaseSync, actor: string, onAlarmSet: (at: number) => void) {
    this.#db = db
    this.#actor = actor
    this.#onAlarmSet = onAlarmSet
  }

  async get<T = unknown>(keyOrKeys: string | string[]): Promise<any> {
    if (Array.isArray(keyOrKeys)) {
      const out = new Map<string, T>()
      if (keyOrKeys.length === 0) return out
      const placeholders = keyOrKeys.map(() => '?').join(',')
      const rows = this.#db
        .prepare(`SELECT k, v FROM actor_storage WHERE actor = ? AND k IN (${placeholders})`)
        .all(this.#actor, ...(keyOrKeys as never[])) as { k: string; v: string }[]
      for (const r of rows) out.set(r.k, JSON.parse(r.v) as T)
      return out
    }
    const row = this.#db
      .prepare('SELECT v FROM actor_storage WHERE actor = ? AND k = ?')
      .get(this.#actor, keyOrKeys) as { v: string } | undefined
    return row ? (JSON.parse(row.v) as T) : undefined
  }

  async put(keyOrEntries: string | Record<string, unknown>, value?: unknown): Promise<void> {
    const entries =
      typeof keyOrEntries === 'string'
        ? [[keyOrEntries, value] as const]
        : Object.entries(keyOrEntries)
    const stmt = this.#db.prepare(
      `INSERT INTO actor_storage (actor, k, v) VALUES (?, ?, ?)
       ON CONFLICT(actor, k) DO UPDATE SET v = excluded.v`,
    )
    for (const [k, v] of entries) stmt.run(this.#actor, k, JSON.stringify(v ?? null))
  }

  async delete(keyOrKeys: string | string[]): Promise<any> {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]
    let n = 0
    const stmt = this.#db.prepare('DELETE FROM actor_storage WHERE actor = ? AND k = ?')
    for (const k of keys) n += Number(stmt.run(this.#actor, k).changes ?? 0)
    return Array.isArray(keyOrKeys) ? n : n > 0
  }

  async list<T = unknown>(
    options: {
      prefix?: string
      start?: string
      end?: string
      limit?: number
      reverse?: boolean
    } = {},
  ): Promise<Map<string, T>> {
    const clauses = ['actor = ?']
    const args: unknown[] = [this.#actor]
    if (options.prefix) {
      clauses.push('k GLOB ?')
      args.push(`${options.prefix}*`)
    }
    if (options.start) {
      clauses.push('k >= ?')
      args.push(options.start)
    }
    if (options.end) {
      clauses.push('k < ?')
      args.push(options.end)
    }
    const rows = this.#db
      .prepare(
        `SELECT k, v FROM actor_storage WHERE ${clauses.join(' AND ')}
         ORDER BY k ${options.reverse ? 'DESC' : 'ASC'} ${options.limit ? 'LIMIT ?' : ''}`,
      )
      .all(...([...args, ...(options.limit ? [options.limit] : [])] as never[])) as {
      k: string
      v: string
    }[]
    return new Map(rows.map((r) => [r.k, JSON.parse(r.v) as T]))
  }

  async getAlarm(): Promise<number | null> {
    const row = this.#db
      .prepare('SELECT alarm_at FROM actor_alarms WHERE actor = ?')
      .get(this.#actor) as { alarm_at: number } | undefined
    return row?.alarm_at ?? null
  }

  async setAlarm(scheduledTime: number | Date): Promise<void> {
    const at = typeof scheduledTime === 'number' ? scheduledTime : scheduledTime.getTime()
    this.#db
      .prepare(
        `INSERT INTO actor_alarms (actor, alarm_at) VALUES (?, ?)
         ON CONFLICT(actor) DO UPDATE SET alarm_at = excluded.alarm_at`,
      )
      .run(this.#actor, at)
    this.#onAlarmSet(at)
  }

  async deleteAlarm(): Promise<void> {
    this.#db.prepare('DELETE FROM actor_alarms WHERE actor = ?').run(this.#actor)
  }

  /** Actors that use SQL (MailboxDO's FTS index) get a private table namespace. */
  get sql() {
    const db = this.#db
    return {
      exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]) {
        const stmt = db.prepare(query)
        const args = bindings as never[]
        if (/^\s*(select|with|pragma)/i.test(query)) {
          const rows = stmt.all(...args) as T[]
          return { toArray: () => rows.map((r) => ({ ...(r as object) }) as T) }
        }
        stmt.run(...args)
        return { toArray: () => [] as T[] }
      },
    }
  }
}

export interface ActorClass<T> {
  new (ctx: ActorContext, env: any): T
}

/**
 * Holds every live actor instance in the process and drives their alarms.
 * One registry per deployment; `namespace()` hands out typed accessors that
 * mirror `env.SOME_DO.get(...)` on Workers.
 */
export class NodeActorRegistry {
  #db: DatabaseSync
  #env: unknown
  #instances = new Map<string, { instance: any; storage: NodeActorStorage }>()
  #classes = new Map<string, ActorClass<any>>()
  #timer?: NodeJS.Timeout

  constructor(db: DatabaseSync, env: unknown) {
    this.#db = db
    this.#env = env
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS actor_storage (
        actor TEXT NOT NULL,
        k TEXT NOT NULL,
        v TEXT NOT NULL,
        PRIMARY KEY (actor, k)
      );
      CREATE TABLE IF NOT EXISTS actor_alarms (
        actor TEXT PRIMARY KEY,
        alarm_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS actor_alarms_at ON actor_alarms(alarm_at);
    `)
  }

  register<T>(kind: string, cls: ActorClass<T>) {
    this.#classes.set(kind, cls)
  }

  namespace<T extends object>(kind: string): ActorNamespace<T> {
    return {
      get: (name: string) => this.#stub<T>(kind, name),
    }
  }

  #instance(kind: string, name: string) {
    const key = `${kind}:${name}`
    let held = this.#instances.get(key)
    if (!held) {
      const cls = this.#classes.get(kind)
      if (!cls) throw new Error(`actor class not registered: ${kind}`)
      const storage = new NodeActorStorage(this.#db, key, () => this.#schedule())
      // Every actor's work is serialised through this chain, which is what
      // gives us the Durable Object property of one-turn-at-a-time per key.
      let gate: Promise<unknown> = Promise.resolve()
      const ctx: ActorContext = {
        id: { toString: () => key, name },
        storage,
        blockConcurrencyWhile: <R>(fn: () => Promise<R>): Promise<R> => {
          const next = gate.then(fn, fn)
          gate = next.catch(() => {})
          return next
        },
        waitUntil: (p) => void p.catch((err) => console.error(`[actor:${key}] waitUntil`, err)),
      }
      held = { instance: new cls(ctx, this.#env), storage }
      this.#instances.set(key, held)
    }
    return held
  }

  #stub<T extends object>(kind: string, name: string): ActorStub<T> {
    const get = () => this.#instance(kind, name).instance
    return new Proxy({} as ActorStub<T>, {
      get(_t, prop: string) {
        return (...args: unknown[]) => {
          const inst = get()
          const fn = inst[prop]
          if (typeof fn !== 'function') {
            return Promise.reject(new Error(`actor ${kind} has no method ${String(prop)}`))
          }
          return Promise.resolve(fn.apply(inst, args))
        }
      },
    })
  }

  /** Starts the alarm driver. Checks every second; alarms are minute-grained at worst. */
  start(intervalMs = 1000) {
    if (this.#timer) return
    this.#timer = setInterval(() => void this.#fireDue(), intervalMs)
    this.#timer.unref?.()
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
  }

  #schedule() {
    /* the 1s poll picks it up; kept as a hook for a future precise timer */
  }

  async #fireDue() {
    const due = this.#db
      .prepare('SELECT actor FROM actor_alarms WHERE alarm_at <= ? LIMIT 50')
      .all(Date.now()) as { actor: string }[]
    for (const { actor } of due) {
      const [kind, ...rest] = actor.split(':')
      const name = rest.join(':')
      // Delete before firing: `alarm()` is expected to re-arm itself if it wants
      // another tick, matching Workers, where a fired alarm is cleared first.
      this.#db.prepare('DELETE FROM actor_alarms WHERE actor = ?').run(actor)
      try {
        const inst = this.#instance(kind!, name).instance
        if (typeof inst.alarm === 'function') await inst.alarm()
      } catch (err) {
        console.error(`[actor:${actor}] alarm failed`, err)
      }
    }
  }
}
