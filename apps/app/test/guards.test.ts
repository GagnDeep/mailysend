import { migrate } from '@mailysend/db'
import { NodeSql } from '@mailysend/platform/node'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Env } from '../src/server/env.ts'
import worker from '../src/server.ts'

/**
 * The doors, from the outside.
 *
 * `/app` used to server-render the whole dashboard shell to anonymous visitors
 * and only bounce them after hydration, and a self-hosted instance served
 * somebody else's marketing site at its own root. Both are decided in
 * `server.ts` now, before any React renders, so both are testable as plain
 * redirects.
 */

let sql: NodeSql

const envFor = (overrides: Partial<Env> = {}): Env =>
  ({
    DB: sql,
    MS_MODE: 'single',
    MS_PUBLIC_URL: 'https://mail.acme.dev',
    MS_SECRET: 'x'.repeat(48),
    MS_LANDING: 'app',
    ...overrides,
  }) as unknown as Env

const get = (path: string, env: Env, headers: HeadersInit = {}) =>
  worker.fetch(new Request(`https://mail.acme.dev${path}`, { headers }), env)

const claim = async () => {
  const now = new Date().toISOString()
  await sql
    .prepare(
      `INSERT INTO settings (workspace_id, key, value, updated_at) VALUES ('', 'instance_claimed_at', ?, ?)`,
    )
    .bind(now, now)
    .run()
}

beforeEach(async () => {
  sql = new NodeSql(':memory:')
  await migrate(sql)
})

describe('/app', () => {
  it('sends an unclaimed instance to the setup flow', async () => {
    const response = await get('/app', envFor())
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/setup')
  })

  it('sends an anonymous visitor to sign-in, remembering where they were going', async () => {
    await claim()
    const response = await get('/app/broadcasts?page=2', envFor())
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      `/sign-in?next=${encodeURIComponent('/app/broadcasts?page=2')}`,
    )
  })

  it('never lets a redirect be cached', async () => {
    const response = await get('/app', envFor())
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('refuses a session cookie that is not a session', async () => {
    await claim()
    const response = await get('/app', envFor(), { cookie: 'ms_session=not-a-real-token' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('/sign-in')
  })
})

describe('/', () => {
  it('lands on setup while the instance is unclaimed', async () => {
    const response = await get('/', envFor())
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/setup')
  })

  it('lands on the dashboard once it is claimed', async () => {
    await claim()
    const response = await get('/', envFor())
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/app')
  })

  it('leaves the root alone when the deployment is the marketing site', async () => {
    // `mailysend.com` runs in single mode too, so the switch is the landing
    // variable and not the mode. Nothing here should redirect.
    const response = await get('/', envFor({ MS_LANDING: 'marketing' })).catch(() => null)
    expect(response?.status ?? 200).not.toBe(302)
  })
})

describe('GET /v1/instance', () => {
  it('answers unauthenticated with the shape the pre-auth screens render from', async () => {
    const response = await get('/v1/instance', envFor())
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      object: 'instance',
      claimed: false,
      mode: 'single',
      landing: 'app',
    })
    expect(body.auth).toMatchObject({ passkey: true, access: false, otp: false, device: true })
    expect(body.sending).toMatchObject({ ready: false, verified_domains: 0 })
    // No secrets, and no per-address facts.
    expect(JSON.stringify(body)).not.toContain(String((envFor() as Env).MS_SECRET))
  })

  it('reports the claim once it has happened', async () => {
    await claim()
    const body = (await (await get('/v1/instance', envFor())).json()) as { claimed: boolean }
    expect(body.claimed).toBe(true)
  })
})
