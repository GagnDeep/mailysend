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
