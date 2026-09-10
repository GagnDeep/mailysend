import { beforeEach, describe, expect, it } from 'vitest'
import { claimFor, type Harness, harness, verifiedDomain } from './harness.ts'

/**
 * Sign-in.
 *
 * Two of these are regression tests for leaks rather than for features: the
 * uniform 202 was a membership oracle the moment `deliverCode` could throw, and
 * the hourly cap destroyed a live code while reporting success, which locked
 * people out of their own instance for an hour.
 */

let h: Harness

beforeEach(async () => {
  h = await harness()
  await claimFor(h)
})

const otp = (email: string) =>
  h.fetch('/v1/auth/otp', { method: 'POST', body: JSON.stringify({ email }) })

describe('POST /v1/auth/otp', () => {
  it('says `unavailable` when nothing can be sent, instead of promising an inbox', async () => {
    const response = await otp('owner@acme.dev')
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ object: 'login_code', status: 'unavailable' })
  })

  it('reports `sent` once a domain is verified', async () => {
    await verifiedDomain(h)
    const body = (await (await otp('owner@acme.dev')).json()) as { status: string }
    expect(body.status).toBe('sent')
  })

  it('answers identically for an address that does not exist', async () => {
    await verifiedDomain(h)
    const known = await (await otp('owner@acme.dev')).json()
    const unknown = await (await otp('nobody@acme.dev')).json()
    expect(unknown).toEqual(known)
  })

  it('does not destroy a live code when the hourly cap is reached', async () => {
    // Eleven requests: the eleventh is over the cap and must change nothing.
    for (let i = 0; i < 10; i++) await otp('owner@acme.dev')
    const live = await h.sql
      .prepare(
        'SELECT id FROM login_codes WHERE email = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1',
      )
      .bind('owner@acme.dev')
      .first<{ id: string }>()
    expect(live).toBeTruthy()

    const capped = await otp('owner@acme.dev')
    expect(capped.status).toBe(202)

    const after = await h.sql
      .prepare('SELECT consumed_at FROM login_codes WHERE id = ?')
      .bind(live!.id)
      .first<{ consumed_at: string | null }>()
    // The code the user is holding is still the one that works.
    expect(after?.consumed_at).toBeNull()
  })

  it('records the requester, so one source cannot spray a thousand addresses', async () => {
    await otp('owner@acme.dev')
    const row = await h.sql
      .prepare('SELECT ip FROM login_codes WHERE email = ?')
      .bind('owner@acme.dev')
      .first<{ ip: string | null }>()
    expect(row?.ip).toBeTruthy()
  })
})

describe('POST /v1/auth/session', () => {
  it('refuses a code that was never issued', async () => {
    const response = await h.fetch('/v1/auth/session', {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@acme.dev', code: '000000' }),
    })
    expect(response.status).toBe(401)
  })

  it('does not enrol a stranger on a claimed instance', async () => {
    await verifiedDomain(h)
    await otp('stranger@elsewhere.dev')
    const row = await h.sql
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind('stranger@elsewhere.dev')
      .first<{ id: string }>()
    expect(row).toBeNull()
  })
})

describe('POST /v1/auth/passkey/options', () => {
  it('mints a challenge and stores it server-side', async () => {
    const response = await h.fetch('/v1/auth/passkey/options', { method: 'POST' })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { rp_id: string; options: { challenge: string } }
    expect(body.rp_id).toBe('mail.acme.dev')

    const stored = await h.sql
      .prepare('SELECT kind, rp_id FROM webauthn_challenges WHERE challenge = ?')
      .bind(body.options.challenge)
      .first<{ kind: string; rp_id: string }>()
    expect(stored).toMatchObject({ kind: 'authenticate', rp_id: 'mail.acme.dev' })
  })

  it('spends a challenge exactly once, whatever the assertion says', async () => {
    const body = (await (await h.fetch('/v1/auth/passkey/options', { method: 'POST' })).json()) as {
      options: { challenge: string }
    }
    const challenge = body.options.challenge

    const first = await h.fetch('/v1/auth/passkey/verify', {
      method: 'POST',
      body: JSON.stringify({ challenge, response: { id: 'no-such-credential' } }),
    })
    expect(first.status).toBe(401)

    const stored = await h.sql
      .prepare('SELECT challenge FROM webauthn_challenges WHERE challenge = ?')
      .bind(challenge)
      .first()
    expect(stored).toBeNull()
  })
})

describe('the CLI device flow', () => {
  it('starts, stays pending, and only becomes a token after approval', async () => {
    const start = await h.fetch('/v1/auth/device', {
      method: 'POST',
      body: JSON.stringify({ client: 'mailysend-cli' }),
    })
    expect(start.status).toBe(200)
    const device = (await start.json()) as { device_code: string; user_code: string }
    expect(device.user_code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/)

    const pending = await h.fetch('/v1/auth/device/token', {
      method: 'POST',
      body: JSON.stringify({ device_code: device.device_code }),
    })
    expect(pending.status).toBe(428)

    // The device code is never stored in the clear.
    const row = await h.sql
      .prepare('SELECT device_code_hash FROM device_codes WHERE user_code = ?')
      .bind(device.user_code)
      .first<{ device_code_hash: string }>()
    expect(row?.device_code_hash).not.toBe(device.device_code)
  })

  it('refuses a device code nobody started', async () => {
    const response = await h.fetch('/v1/auth/device/token', {
      method: 'POST',
      body: JSON.stringify({ device_code: 'msd_nothing_here_at_all_000000' }),
    })
    expect(response.status).toBe(401)
  })
})
