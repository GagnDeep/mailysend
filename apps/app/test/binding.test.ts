import { DEFAULT_WORKSPACE, kvKey } from '@mailysend/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Envelope } from '../src/server/send/envelope.ts'
import { claimFor, type Harness, harness, sessionFor } from './harness.ts'

/**
 * A domain's transport binding, made real.
 *
 * The `provider` column decided which DNS records a domain published and then
 * had no say in where its mail went: `resolveDomain` did not even SELECT it, so
 * a domain "bound" to SES sent through whatever the router's hash happened to
 * pick. The published records authorise one transport, so a send that leaves
 * through another is mail its own SPF does not authorise — silently
 * spam-foldered rather than rejected, which is the worst of the three outcomes.
 *
 * These tests are about that pin, and about the cache that stands between the
 * binding and the send path.
 */

let h: Harness
let cookie: string

beforeEach(async () => {
  h = await harness({
    CLOUDFLARE_ACCOUNT_ID: 'acct_1',
    CLOUDFLARE_API_TOKEN: 'tok_1',
  } as never)
  cookie = await sessionFor(h, await claimFor(h))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Captures what the queue is handed, which is where the pin becomes visible. */
function captureJobs(target: Harness = h): Envelope[] {
  const envelopes: Envelope[] = []
  target.env.SEND_QUEUE = {
    send: async (job: { kind: string; envelope?: Envelope }) => {
      if (job.envelope) envelopes.push(job.envelope)
    },
    sendBatch: async () => {},
  } as never
  return envelopes
}

/** A verified domain, optionally bound, inserted the way the API would leave it. */
async function domain(name: string, provider: string | null): Promise<string> {
  const now = new Date().toISOString()
  const id = `dom_${name.replace(/\W/g, '').toUpperCase().padEnd(26, '0').slice(0, 26)}`
  await h.sql
    .prepare(
      `INSERT INTO domains (id, workspace_id, name, status, provider, created_at, updated_at)
       VALUES (?, ?, ?, 'verified', ?, ?, ?)`,
    )
    .bind(id, DEFAULT_WORKSPACE, name, provider, now, now)
    .run()
  return id
}

const send = async (from: string, subject: string, target: Harness = h, jar = cookie) =>
  await target.fetch('/v1/mail/send', {
    method: 'POST',
    cookie: jar,
    body: JSON.stringify({
      from,
      to: ['someone@example.com'],
      subject,
      text: 'Body.',
      immediate: false,
    }),
  })

describe('the binding decides the transport', () => {
  it('pins the send to the transport the domain is bound to', async () => {
    await domain('bound.dev', 'ses')
    const envelopes = captureJobs()

    expect((await send('team@bound.dev', 'Pinned')).status).toBe(200)
    expect(envelopes[0]?.provider).toBe('ses')
  })

  it('leaves an unbound domain to the router, as it always did', async () => {
    await domain('free.dev', null)
    const envelopes = captureJobs()

    expect((await send('team@free.dev', 'Unpinned')).status).toBe(200)
    expect(envelopes[0]?.provider).toBeUndefined()
  })

  it('lets an explicit request provider beat the binding', async () => {
    // Both transports are reachable here, so this is a statement about
    // precedence and not about availability: a caller naming a provider is
    // overriding their own configuration on purpose.
    await domain('bound.dev', 'ses')
    const envelopes = captureJobs()

    // Through the public API, which is the surface that takes a `provider` at
    // all — the composer deliberately does not offer one.
    const res = await h.fetch('/v1/emails', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        from: 'team@bound.dev',
        to: ['someone@example.com'],
        subject: 'Overridden',
        text: 'Body.',
        provider: 'cloudflare',
      }),
    })
    expect(res.status).toBe(200)
    expect(envelopes[0]?.provider).toBe('cloudflare')
  })

  it('fails permanently, naming the domain and the transport, rather than failing over', async () => {
    // The router carries Cloudflare and nothing else. Before the guard, an
    // unsatisfiable pin selected `null` and surfaced as "No sending provider is
    // configured" — a lie when a transport *is* configured and the domain is
    // simply bound to a different one.
    await domain('orphan.dev', 'ses')

    // Delivered inline, so the verdict is on the message by the time this
    // returns rather than sitting in a queue nobody is consuming.
    const res = await h.fetch('/v1/mail/send', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        from: 'team@orphan.dev',
        to: ['someone@example.com'],
        subject: 'Nowhere',
        text: 'Body.',
      }),
    })
    expect(res.status).toBe(200)
    const { id } = (await res.json()) as { id: string }

    const email = (await (await h.fetch(`/v1/emails/${id}`, { cookie })).json()) as {
      last_event: string
      provider: string | null
      error: string | null
    }
    expect(email.last_event).toBe('failed')
    expect(email.error).toContain('orphan.dev')
    expect(email.error).toContain('ses')
    expect(email.error).not.toMatch(/no sending provider is configured/i)
  })
})

describe('the cached domain row', () => {
  it('carries a version, so a rolling deploy cannot serve a row without the binding', () => {
    // The cached value is a row shape. When `provider` was added to
    // `resolveDomain`'s SELECT without a bump, a bound domain kept being routed
    // by hash for the five minutes the old rows had left to live.
    expect(kvKey.domain('ws_default', 'acme.dev')).toContain(':v2:')
  })

  it('sees a rebind on the next send, not five minutes later', async () => {
    const id = await domain('rebind.dev', 'cloudflare')
    const envelopes = captureJobs()

    expect((await send('team@rebind.dev', 'First')).status).toBe(200)
    expect(envelopes[0]?.provider).toBe('cloudflare')

    await h.fetch(`/v1/domains/${id}`, {
      method: 'PATCH',
      cookie,
      body: JSON.stringify({ provider: 'ses' }),
    })
    // A rebind re-derives the records, so the domain is back to `not_started`
    // and a live send is refused. Stand it back up the way a verify would,
    // deliberately *without* touching the cache — a stale row would still be
    // sitting there, carrying `cloudflare`, and this send would pin it.
    await h.sql.prepare("UPDATE domains SET status = 'verified' WHERE id = ?").bind(id).run()

    expect((await send('team@rebind.dev', 'Second')).status).toBe(200)
    expect(envelopes[1]?.provider).toBe('ses')
  })

  it('does not go on accepting live sends for a domain whose records were just reset', async () => {
    // `POST /:id/identity` calls `writeRecords`, which resets `status` to
    // `not_started`, and was the one caller that never busted the cache — so
    // the send path kept accepting live mail for up to 300 seconds from a
    // domain that no longer had a published record set. `MemoryKv` ignores
    // `expirationTtl`, so a missing delete never expires away: this is
    // deterministic rather than a race, which makes it stricter than
    // production.
    const id = await domain('reset.dev', 'resend')
    await h.fetch('/v1/providers/resend', {
      method: 'PUT',
      cookie,
      body: JSON.stringify({ enabled: true, credentials: { api_key: 're_x' } }),
    })
    captureJobs()
    expect((await send('team@reset.dev', 'Warms the cache')).status).toBe(200)

    // Resend mints the DKIM key, so its `ensure` is what hands back records —
    // and records are what trigger the rewrite.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: { method?: string }) => {
        if (String(input).endsWith('/domains') && init?.method === 'POST') {
          return Response.json({
            id: 'rsd_1',
            name: 'reset.dev',
            status: 'not_started',
            records: [
              { record: 'TXT', name: 'rs1._domainkey.reset.dev', value: 'p=NEWKEY', type: 'TXT' },
            ],
          })
        }
        return Response.json({ data: [] })
      }),
    )
    const identity = await h.fetch(`/v1/domains/${id}/identity`, { method: 'POST', cookie })
    expect(identity.status).toBe(200)
    vi.unstubAllGlobals()

    const res = await send('team@reset.dev', 'After the reset')
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('domain_not_verified')
  })
})
