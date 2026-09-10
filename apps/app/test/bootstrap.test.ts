import { migrate } from '@mailysend/db'
import { NodeSql } from '@mailysend/platform/node'
import { beforeEach, describe, expect, it } from 'vitest'
import { configure } from '../src/server/bootstrap.ts'
import type { Env } from '../src/server/env.ts'

/**
 * The one-click deploy hands the app an environment with nothing in it. These
 * pin the two values that used to be mandatory, because the failure mode when
 * they regress is silent and permanent: a secret that changes invalidates every
 * tracking link ever signed, and a public URL that reverts sends every future
 * link to the wrong host.
 */

const envFor = (sql: NodeSql, overrides: Partial<Env> = {}): Env =>
  ({ DB: sql, MS_MODE: 'single', ...overrides }) as unknown as Env

let sql: NodeSql

beforeEach(async () => {
  sql = new NodeSql(':memory:')
  await migrate(sql)
})

describe('configure', () => {
  it('generates a signing secret when none is set, and reuses it', async () => {
    const first = await configure(envFor(sql), new Request('https://mail.acme.dev/'))
    expect(first.MS_SECRET).toMatch(/^[0-9a-f]{64}$/)

    const second = await configure(envFor(sql), new Request('https://mail.acme.dev/'))
    expect(second.MS_SECRET).toBe(first.MS_SECRET)
  })

  it('prefers an explicitly configured secret over the stored one', async () => {
    const pinned = 'x'.repeat(48)
    const env = await configure(envFor(sql, { MS_SECRET: pinned }), new Request('https://a.dev/'))
    expect(env.MS_SECRET).toBe(pinned)
  })

  it('learns the public URL from the request and keeps it for handlers without one', async () => {
    await configure(envFor(sql), new Request('https://mail.acme.dev/v1/emails'))
    // A queue consumer has no request; it must still mint links on the host the
    // dashboard is actually served from.
    const queueEnv = await configure(envFor(sql))
    expect(queueEnv.MS_PUBLIC_URL).toBe('https://mail.acme.dev')
  })

  it('adopts a custom domain after a workers.dev first request', async () => {
    await configure(envFor(sql), new Request('https://mailysend.workers.dev/'))
    const later = await configure(envFor(sql), new Request('https://mail.acme.dev/'))
    expect(later.MS_PUBLIC_URL).toBe('https://mail.acme.dev')
  })

  it('never stores a localhost origin over a real one', async () => {
    await configure(envFor(sql), new Request('https://mail.acme.dev/'))
    const dev = await configure(envFor(sql), new Request('http://localhost:8917/'))
    expect(dev.MS_PUBLIC_URL).toBe('https://mail.acme.dev')
  })

  it('leaves a pinned public URL alone', async () => {
    const env = await configure(
      envFor(sql, { MS_PUBLIC_URL: 'https://pinned.example' }),
      new Request('https://other.example/'),
    )
    expect(env.MS_PUBLIC_URL).toBe('https://pinned.example')
  })

  it('creates the workspace and exactly one bootstrap key', async () => {
    await configure(envFor(sql), new Request('https://mail.acme.dev/'))
    const keys = await sql.prepare('SELECT COUNT(*) AS n FROM api_keys').first<{ n: number }>()
    expect(keys?.n).toBe(1)
  })
})

/**
 * Actor bindings, on the runtime that does not take names.
 *
 * Every actor in MailySend is a singleton for some key, so the codebase
 * addresses them by a name from `doName()`. The Node registry accepts those
 * names directly, which is why the whole suite passed while a real
 * `DurableObjectNamespace` — which wants an id — answered every actor call on
 * Workers with "parameter 1 is not of type 'DurableObjectId'". A send failed on
 * that, and its reported reason was a type error about a parameter.
 */
describe('actor bindings', () => {
  /** What Workers hands the app: ids by name, and `get` refusing anything else. */
  const fakeDoNamespace = () => {
    const seen: string[] = []
    return {
      seen,
      idFromName(name: string) {
        seen.push(name)
        return { __id: name }
      },
      get(id: unknown) {
        if (typeof id !== 'object' || id === null || !('__id' in id)) {
          throw new TypeError(
            "Failed to execute 'get' on 'DurableObjectNamespace': parameter 1 is not of type 'DurableObjectId'.",
          )
        }
        return { stub: (id as { __id: string }).__id }
      },
    }
  }

  it('turns a name into an id before reaching a Durable Object namespace', async () => {
    const ns = fakeDoNamespace()
    const env = await configure(
      envFor(sql, { WORKSPACE_HUB: ns as never }),
      new Request('https://mail.acme.dev/'),
    )

    expect(() => env.WORKSPACE_HUB.get('WorkspaceHub:ws_default')).not.toThrow()
    expect(env.WORKSPACE_HUB.get('WorkspaceHub:ws_default')).toEqual({
      stub: 'WorkspaceHub:ws_default',
    })
    expect(ns.seen).toContain('WorkspaceHub:ws_default')
  })

  it('is idempotent, because configure runs on every request', async () => {
    const ns = fakeDoNamespace()
    const env = envFor(sql, { MAILBOX: ns as never })
    await configure(env, new Request('https://mail.acme.dev/'))
    const twice = await configure(env, new Request('https://mail.acme.dev/'))
    expect(twice.MAILBOX.get('Mailbox:ws_default:imb_1')).toEqual({
      stub: 'Mailbox:ws_default:imb_1',
    })
  })

  it('leaves a namespace that already takes names alone', async () => {
    // The Node registry, and anything else without `idFromName`.
    const registry = { get: (name: string) => ({ named: name }) }
    const env = await configure(
      envFor(sql, { SENDING_DOMAIN: registry as never }),
      new Request('https://mail.acme.dev/'),
    )
    expect(env.SENDING_DOMAIN).toBe(registry)
  })
})
