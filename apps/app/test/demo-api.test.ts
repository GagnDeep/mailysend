import { beforeEach, describe, expect, it } from 'vitest'
import { type Harness, harness } from './harness.ts'

/**
 * `/v1/demo` — the door into the product tour.
 *
 * Two properties are worth a test and the rest is plumbing. First, it exists
 * only on a deployment that is a shop window: on somebody's own instance the
 * dashboard has their mail in it and a fake version of the same screen is a
 * door drawn on a wall. Second, the cookie it hands back is not a credential —
 * a request carrying it and nothing else is still anonymous to the API, which
 * is the whole reason it is safe to give to anyone who types an address.
 */

let h: Harness

describe('on a shop window', () => {
  beforeEach(async () => {
    h = await harness({ MS_LANDING: 'marketing' } as never)
  })

  const start = (email: string) =>
    h.fetch('/v1/demo', { method: 'POST', body: JSON.stringify({ email }) })

  it('files the address and hands back the tour cookie', async () => {
    const response = await start('visitor@example.com')
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('ms_demo_tour=1')

    const contact = await h.sql
      .prepare('SELECT email FROM contacts WHERE workspace_id = ?')
      .bind('ws_default')
      .first<{ email: string }>()
    expect(contact?.email).toBe('visitor@example.com')
  })

  it('files it into an audience the operator can actually find', async () => {
    await start('visitor@example.com')
    const audience = await h.sql
      .prepare('SELECT name, contact_count FROM audiences WHERE workspace_id = ?')
      .bind('ws_default')
      .first<{ name: string; contact_count: number }>()
    expect(audience).toMatchObject({ name: 'Demo signups', contact_count: 1 })
  })

  it('refuses something that is not an address', async () => {
    const response = await start('not-an-address')
    expect(response.status).toBe(422)
  })

  it('throttles the second address from a caller without shutting the door', async () => {
    expect((await start('one@example.com')).status).toBe(200)
    // Still 200, still a cookie: the throttle drops the lead, never the tour.
    // Offices share one egress IP, and the second person to click is a reader
    // we would be turning away from a page of sample data.
    const second = await start('two@example.com')
    expect(second.status).toBe(200)
    expect(second.headers.get('set-cookie')).toContain('ms_demo_tour=1')

    const rows = await h.sql
      .prepare('SELECT email FROM contacts WHERE workspace_id = ?')
      .bind('ws_default')
      .all<{ email: string }>()
    expect(rows.results.map((row) => row.email)).toEqual(['one@example.com'])
  })

  it('hands out a cookie that authenticates nothing', async () => {
    const response = await start('visitor@example.com')
    const cookie = h.cookieFrom(response)
    // The demo's data lives in the browser bundle; the API has never heard of
    // it. If this ever returns 200 the tour has become an authentication
    // bypass, which is the one way this feature could be dangerous.
    expect((await h.fetch('/v1/logs', { cookie })).status).toBe(401)
    expect((await h.fetch('/v1/me', { cookie })).status).toBe(401)
  })

  it('lets go when asked', async () => {
    const response = await h.fetch('/v1/demo', { method: 'DELETE' })
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})

describe("on somebody's own instance", () => {
  beforeEach(async () => {
    h = await harness({ MS_LANDING: 'app' } as never)
  })

  it('has no demo to offer', async () => {
    const response = await h.fetch('/v1/demo', {
      method: 'POST',
      body: JSON.stringify({ email: 'visitor@example.com' }),
    })
    expect(response.status).toBe(404)
  })

  it('writes nothing', async () => {
    await h.fetch('/v1/demo', {
      method: 'POST',
      body: JSON.stringify({ email: 'visitor@example.com' }),
    })
    const row = await h.sql.prepare('SELECT COUNT(*) AS n FROM contacts').first<{ n: number }>()
    expect(row?.n).toBe(0)
  })
})
