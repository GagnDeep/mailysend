import { migrate } from '@mailysend/db'
import type { Kv } from '@mailysend/platform'
import { NodeSql } from '@mailysend/platform/node'
import { api } from '../src/server/api/index.ts'
import { configure } from '../src/server/bootstrap.ts'
import { type Env, runWithEnv } from '../src/server/env.ts'
import { issueSession } from '../src/server/session.ts'

/**
 * A whole instance, in memory, reachable through `fetch`.
 *
 * The first-run and sign-in bugs this release fixes all shared one property:
 * they were invisible to a unit test of any single function and obvious the
 * moment a request went through the real router. So these tests drive `api` end
 * to end — cookies, status codes and all — against a real SQLite database with
 * the real migrations applied.
 */

/** Enough of KV for the API-key cache and the rate limiter. */
class MemoryKv implements Kv {
  #store = new Map<string, string>()

  async get(key: string, type?: 'text' | 'json'): Promise<never> {
    const held = this.#store.get(key) ?? null
    return (type === 'json' && held !== null ? JSON.parse(held) : held) as never
  }

  async put(key: string, value: string | ArrayBuffer | ReadableStream): Promise<void> {
    this.#store.set(key, typeof value === 'string' ? value : String(value))
  }

  async delete(key: string): Promise<void> {
    this.#store.delete(key)
  }

  async list() {
    return { keys: [...this.#store.keys()].map((name) => ({ name })), list_complete: true }
  }
}

const noopQueue = { send: async () => {}, sendBatch: async () => {} }

export interface Harness {
  env: Env
  sql: NodeSql
  fetch(path: string, init?: RequestInit & { cookie?: string }): Promise<Response>
  /** The `ms_session` cookie value from a sign-in response, ready to send back. */
  cookieFrom(response: Response): string
}

export async function harness(overrides: Partial<Env> = {}): Promise<Harness> {
  const sql = new NodeSql(':memory:')
  await migrate(sql)

  const base = {
    DB: sql,
    CACHE: new MemoryKv(),
    SUPPRESSIONS: new MemoryKv(),
    MS_MODE: 'single',
    MS_PUBLIC_URL: 'https://mail.acme.dev',
    MS_SECRET: 'x'.repeat(48),
    SEND_QUEUE: noopQueue,
    SEND_BULK_QUEUE: noopQueue,
    EVENTS_QUEUE: noopQueue,
    WEBHOOKS_QUEUE: noopQueue,
    BROADCAST_QUEUE: noopQueue,
    INBOUND_QUEUE: noopQueue,
    SEGMENTS_QUEUE: noopQueue,
    AUTOMATION_QUEUE: noopQueue,
    DMARC_QUEUE: noopQueue,
    EXPORT_QUEUE: noopQueue,
    ...overrides,
  } as unknown as Env

  const env = await configure(base, new Request('https://mail.acme.dev/'))

  return {
    env,
    sql,
    fetch(path, init = {}) {
      const { cookie, ...rest } = init
      const headers = new Headers(rest.headers)
      headers.set('content-type', 'application/json')
      if (cookie) headers.set('cookie', cookie)
      const request = new Request(`https://mail.acme.dev${path}`, { ...rest, headers })
      return runWithEnv(env, { waitUntil: () => {} }, () => api.fetch(request, env))
    },
    cookieFrom(response) {
      return response.headers.get('set-cookie')?.split(';')[0] ?? ''
    },
  }
}

/** Marks the instance claimed without going through the passkey ceremony. */
export async function claimFor(h: Harness, email = 'owner@acme.dev'): Promise<string> {
  const now = new Date().toISOString()
  const userId = 'usr_TESTOWNER00000000000000'
  await h.sql.batch([
    h.sql
      .prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,?)')
      .bind(userId, email, now),
    h.sql
      .prepare(
        `INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES ('ws_default',?,'owner',?)`,
      )
      .bind(userId, now),
    h.sql
      .prepare(
        `INSERT INTO settings (workspace_id, key, value, updated_at) VALUES ('', 'instance_claimed_at', ?, ?)`,
      )
      .bind(now, now),
  ])
  return userId
}

/** Adds a verified sending domain, which is what unlocks the emailed code. */
export async function verifiedDomain(h: Harness, name = 'acme.dev'): Promise<string> {
  const now = new Date().toISOString()
  const id = `dom_${name.replace(/\W/g, '').toUpperCase().padEnd(26, '0').slice(0, 26)}`
  await h.sql
    .prepare(
      `INSERT INTO domains (id, workspace_id, name, status, created_at, updated_at)
       VALUES (?, 'ws_default', ?, 'verified', ?, ?)`,
    )
    .bind(id, name, now, now)
    .run()
  return id
}

/** A signed-in cookie for an owner, without going through any sign-in door. */
export async function sessionFor(h: Harness, userId: string): Promise<string> {
  const token = await issueSession(
    h.sql,
    userId,
    'ws_default',
    new Request('https://mail.acme.dev/'),
  )
  return `ms_session=${token}`
}
