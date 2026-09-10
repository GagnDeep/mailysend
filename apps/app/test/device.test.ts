import { beforeEach, describe, expect, it } from 'vitest'
import { claimFor, type Harness, harness, sessionFor } from './harness.ts'

/**
 * `mailysend login`, end to end.
 *
 * The CLI has been calling these three endpoints since it was written; they did
 * not exist. So the test that matters is the whole round trip — start, approve
 * from a browser, poll, exchange — and the two ways it must refuse: before
 * approval, and after the token has already been handed over once.
 */

let h: Harness
let cookie: string

beforeEach(async () => {
  h = await harness()
  cookie = await sessionFor(h, await claimFor(h))
})

const start = async (client = 'mailysend-cli') =>
  (await (
    await h.fetch('/v1/auth/device', { method: 'POST', body: JSON.stringify({ client }) })
  ).json()) as { device_code: string; user_code: string; verification_url: string }

const poll = (deviceCode: string) =>
  h.fetch('/v1/auth/device/token', {
    method: 'POST',
    body: JSON.stringify({ device_code: deviceCode }),
  })

const approve = (userCode: string) =>
  h.fetch('/v1/auth/device/approve', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ user_code: userCode }),
  })

describe('the device flow', () => {
  it('starts pending, and becomes a working key after approval', async () => {
    const device = await start()
    expect(device.verification_url).toBe('https://mail.acme.dev/app/settings?section=security')
    expect((await poll(device.device_code)).status).toBe(428)

    expect((await approve(device.user_code)).status).toBe(200)

    const exchanged = await poll(device.device_code)
    expect(exchanged.status).toBe(200)
    const { token } = (await exchanged.json()) as { token: string }
    expect(token).toMatch(/^ms_live_/)

    // The key is real: it authenticates against the API it was minted for.
    // Not `/v1/me` — a key is not a person, and that route says so.
    const domains = await h.fetch('/v1/domains', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(domains.status).toBe(200)
  })

  it('hands the token over exactly once', async () => {
    const device = await start()
    await approve(device.user_code)
    expect((await poll(device.device_code)).status).toBe(200)

    const replay = await poll(device.device_code)
    expect(replay.status).toBe(401)
  })

  it('names the key after the client, so it can be told apart and revoked', async () => {
    const device = await start('mailysend-cli')
    await approve(device.user_code)
    const row = await h.sql
      .prepare('SELECT name, permission FROM api_keys WHERE name LIKE ?')
      .bind('CLI%')
      .first<{ name: string; permission: string }>()
    expect(row).toMatchObject({ name: 'CLI · mailysend-cli', permission: 'full_access' })
  })

  it('shows a waiting device on the approval screen, and stops showing it after', async () => {
    const device = await start()
    const pending = (await (await h.fetch('/v1/auth/device/pending', { cookie })).json()) as {
      data: { user_code: string }[]
    }
    expect(pending.data.map((d) => d.user_code)).toContain(device.user_code)

    await approve(device.user_code)
    const after = (await (await h.fetch('/v1/auth/device/pending', { cookie })).json()) as {
      data: unknown[]
    }
    expect(after.data).toHaveLength(0)
  })

  it('will not approve without a session', async () => {
    const device = await start()
    const response = await h.fetch('/v1/auth/device/approve', {
      method: 'POST',
      body: JSON.stringify({ user_code: device.user_code }),
    })
    expect(response.status).toBe(401)
  })

  it('refuses a denied device, rather than leaving the CLI polling forever', async () => {
    const device = await start()
    await h.fetch('/v1/auth/device/deny', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ user_code: device.user_code }),
    })
    expect((await poll(device.device_code)).status).toBe(401)
  })

  it('refuses an expired device code', async () => {
    const device = await start()
    await h.sql
      .prepare('UPDATE device_codes SET expires_at = ? WHERE user_code = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), device.user_code)
      .run()
    expect((await poll(device.device_code)).status).toBe(401)
    // And it cannot be rescued by approving it late.
    expect((await approve(device.user_code)).status).toBe(401)
  })
})
