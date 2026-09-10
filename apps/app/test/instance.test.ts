import { beforeEach, describe, expect, it } from 'vitest'
import { claimFor, type Harness, harness, verifiedDomain } from './harness.ts'

/**
 * `/v1/instance` is what every pre-auth screen renders from, so its shape is
 * load-bearing in a way an internal helper's is not: a field that goes missing
 * makes the sign-in page offer a door that is not there, which is the exact
 * failure this endpoint was added to end.
 */

let h: Harness

beforeEach(async () => {
  h = await harness()
})

describe('GET /v1/instance', () => {
  it('is reachable with no credentials at all', async () => {
    const response = await h.fetch('/v1/instance')
    expect(response.status).toBe(200)
  })

  it('reports an unclaimed instance, with only the passkey door open', async () => {
    const body = await (await h.fetch('/v1/instance')).json()
    expect(body).toMatchObject({
      object: 'instance',
      claimed: false,
      mode: 'single',
      auth: { passkey: true, access: false, otp: false, device: true },
      sending: { ready: false, verified_domains: 0 },
    })
  })

  it('reports claimed once the instance has an owner', async () => {
    await claimFor(h)
    const body = (await (await h.fetch('/v1/instance')).json()) as { claimed: boolean }
    expect(body.claimed).toBe(true)
  })

  it('opens the emailed-code door only when a domain is verified', async () => {
    await verifiedDomain(h)
    const body = (await (await h.fetch('/v1/instance')).json()) as {
      auth: { otp: boolean }
      sending: { ready: boolean; verified_domains: number }
    }
    expect(body.auth.otp).toBe(true)
    expect(body.sending).toMatchObject({ ready: true, verified_domains: 1 })
  })

  it('advertises Cloudflare Access only when both variables are set', async () => {
    const half = await harness({ MS_ACCESS_TEAM: 'acme.cloudflareaccess.com' })
    const one = (await (await half.fetch('/v1/instance')).json()) as { auth: { access: boolean } }
    expect(one.auth.access).toBe(false)

    const both = await harness({
      MS_ACCESS_TEAM: 'acme.cloudflareaccess.com',
      MS_ACCESS_AUD: 'aud-tag',
    })
    const two = (await (await both.fetch('/v1/instance')).json()) as { auth: { access: boolean } }
    expect(two.auth.access).toBe(true)
  })

  it('never carries a version the repository does not have', async () => {
    const body = (await (await h.fetch('/v1/instance')).json()) as { version: string }
    // The string this replaced was `v1.8.2`, hand-written on four screens.
    expect(body.version).not.toBe('1.8.2')
  })
})

describe('POST /v1/auth/access', () => {
  it('says so plainly when Access is not configured, rather than failing opaquely', async () => {
    const response = await h.fetch('/v1/auth/access', { method: 'POST' })
    expect(response.status).toBe(501)
    const body = (await response.json()) as { message: string }
    expect(body.message).toContain('passkey')
  })
})
