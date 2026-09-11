import { hashApiKey } from '@mailysend/core'
import { migrate } from '@mailysend/db'
import { MailboxActor, SendingDomainActor, WorkspaceHubActor } from '@mailysend/durable'
import type { Blob, BlobBody, BlobObject, Kv } from '@mailysend/platform'
import { NodeActorRegistry, NodeSql } from '@mailysend/platform/node'
import { api } from '../src/server/api/index.ts'
import { CLAIM_CODE_KEY, configure } from '../src/server/bootstrap.ts'
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

/**
 * Enough of R2 to carry a message body.
 *
 * `NodeBlob` writes to the filesystem, which would leave a directory of test
 * mail behind and make two tests running in parallel share a bucket. Mail is
 * the one subsystem whose tests must exercise the blob layer — bodies,
 * attachments and the raw `.eml` all live there — so it gets a real, isolated
 * implementation rather than a stub that returns null.
 */
class MemoryBlob implements Blob {
  #store = new Map<string, { bytes: Uint8Array; contentType?: string }>()

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream | null,
    options?: { httpMetadata?: { contentType?: string } },
  ) {
    const bytes =
      typeof value === 'string'
        ? new TextEncoder().encode(value)
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : ArrayBuffer.isView(value)
            ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
            : new Uint8Array(await new Response(value as ReadableStream).arrayBuffer())
    this.#store.set(key, {
      bytes,
      ...(options?.httpMetadata?.contentType
        ? { contentType: options.httpMetadata.contentType }
        : {}),
    })
    return this.#head(key)
  }

  async get(key: string): Promise<BlobBody | null> {
    const held = this.#store.get(key)
    if (!held) return null
    const buffer = held.bytes.slice().buffer as ArrayBuffer
    return {
      ...(this.#head(key) as BlobObject),
      get body() {
        return new Response(buffer).body as ReadableStream
      },
      arrayBuffer: async () => buffer,
      text: async () => new TextDecoder().decode(held.bytes),
      json: async () => JSON.parse(new TextDecoder().decode(held.bytes)),
    }
  }

  async head(key: string) {
    return this.#head(key)
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.#store.delete(key)
  }

  async list(options: { prefix?: string } = {}) {
    const objects = [...this.#store.keys()]
      .filter((key) => key.startsWith(options.prefix ?? ''))
      .map((key) => this.#head(key) as BlobObject)
    return { objects, truncated: false }
  }

  #head(key: string): BlobObject | null {
    const held = this.#store.get(key)
    if (!held) return null
    return {
      key,
      size: held.bytes.byteLength,
      etag: String(held.bytes.byteLength),
      uploaded: new Date(),
      ...(held.contentType ? { httpMetadata: { contentType: held.contentType } } : {}),
    }
  }
}

const noopQueue = { send: async () => {}, sendBatch: async () => {} }

export interface Harness {
  env: Env
  sql: NodeSql
  blob: MemoryBlob
  fetch(path: string, init?: RequestInit & { cookie?: string }): Promise<Response>
  /** The `ms_session` cookie value from a sign-in response, ready to send back. */
  cookieFrom(response: Response): string
}

/** The claim code every harness instance is pinned to. */
export const CLAIM_CODE = 'TEST-CODE-0001'

export async function harness(overrides: Partial<Env> = {}): Promise<Harness> {
  const sql = new NodeSql(':memory:')
  await migrate(sql)

  const blob = new MemoryBlob()
  // The mail pipeline runs through two actors — the mailbox's threading oracle
  // and the workspace hub's fan-out — so the harness registers the real classes
  // rather than stubbing them. A threading test against a stub proves nothing.
  const actors = new NodeActorRegistry(sql.db, {})
  actors.register('Mailbox', MailboxActor)
  actors.register('WorkspaceHub', WorkspaceHubActor)
  actors.register('SendingDomain', SendingDomainActor)

  const base = {
    DB: sql,
    BUCKET: blob,
    MAILBOX: actors.namespace('Mailbox'),
    WORKSPACE_HUB: actors.namespace('WorkspaceHub'),
    SENDING_DOMAIN: actors.namespace('SendingDomain'),
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

  // First boot mints a claim code only when `MS_REQUIRE_CLAIM_CODE` asks for
  // one, and prints it beside the bootstrap API key, keeping only its hash. A
  // test cannot read the log line, so the row is pinned here to a constant —
  // the gate under test is "the right code and no other", not the randomness of
  // the generator. Written as an upsert rather than an update because the row
  // is absent by default, and a harness that opts in still needs a known code.
  await sql
    .prepare(
      `INSERT INTO settings (workspace_id, key, value, updated_at) VALUES ('', ?, ?, ?)
       ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value`,
    )
    .bind(CLAIM_CODE_KEY, await hashApiKey(CLAIM_CODE), new Date().toISOString())
    .run()

  return {
    env,
    sql,
    blob,
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
