import { beforeEach, describe, expect, it } from 'vitest'
import { claimFor, type Harness, harness, sessionFor } from './harness.ts'

/**
 * The do-not-send list, through the router.
 *
 * `GET /v1/suppressions/{email}` is the endpoint this release adds, and the
 * reason it needed adding is the reason it needs a test: it was in the OpenAPI
 * document from the beginning, so every generated SDK carried the method, and
 * the router had never registered it. The question it answers — may I mail this
 * person? — is the one a caller asks before a send, and for everyone who asked
 * it the documented way the answer was a 404 about the endpoint rather than
 * about the address.
 */

let h: Harness
let cookie: string

beforeEach(async () => {
  h = await harness()
  cookie = await sessionFor(h, await claimFor(h))
})

const suppress = (email: string, reason = 'manual') =>
  h.fetch('/v1/suppressions', {
    method: 'POST',
    cookie,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, reason }),
  })

describe('checking one address', () => {
  it('answers with the suppression, and with the address as it was entered', async () => {
    await suppress('Bounced@Acme.dev', 'hard_bounce')

    const res = await h.fetch('/v1/suppressions/bounced%40acme.dev', { cookie })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.object).toBe('suppression')
    expect(body.reason).toBe('hard_bounce')
    expect(body.email).toBe('Bounced@Acme.dev')
    expect(body.normalized_email).toBe('bounced@acme.dev')
  })

  /**
   * The whole point of normalising on write is that a mailbox is suppressed
   * however it is spelled. A check that did not normalise would answer "not
   * suppressed" for an address this instance would in fact refuse to mail,
   * which is the one wrong answer that loses a customer their list.
   */
  it('finds the row through a different spelling of the same mailbox', async () => {
    await suppress('ab@gmail.com', 'complaint')

    const res = await h.fetch('/v1/suppressions/a.b%2Bnews%40gmail.com', { cookie })
    expect(res.status).toBe(200)
    expect((await res.json()).reason).toBe('complaint')
  })

  it('is a 404 when the address may be mailed', async () => {
    const res = await h.fetch('/v1/suppressions/nobody%40acme.dev', { cookie })
    expect(res.status).toBe(404)
  })

  /** `/bulk` is a static segment; Hono must not read it as an address. */
  it('does not shadow the bulk import', async () => {
    const res = await h.fetch('/v1/suppressions/bulk', {
      method: 'POST',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emails: ['one@acme.dev', 'two@acme.dev'], reason: 'unsubscribe' }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).created).toBe(2)

    expect((await h.fetch('/v1/suppressions/one%40acme.dev', { cookie })).status).toBe(200)
  })
})
