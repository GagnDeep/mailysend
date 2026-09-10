import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claimFor, type Harness, harness, sessionFor } from './harness.ts'

/**
 * Domain verification, told honestly.
 *
 * Every test here is a case where the old code said `verified` about something
 * it had not established: a resolver exception that returned the record's
 * previous status, a DoH non-200 flattened into "nothing published", a record
 * set rewritten underneath a domain whose `status` column was left alone, and
 * two matchers that passed on strings they had not really matched. The
 * assertions are all of the form "this must not read as verified".
 */

let h: Harness
let cookie: string

beforeEach(async () => {
  h = await harness()
  cookie = await sessionFor(h, await claimFor(h))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The DNS the world is pretending to publish, keyed by `<name>/<type>`. */
type Zone = Record<
  string,
  { Status?: number; Answer?: { name: string; type: number; data: string }[] } | 'boom' | number
>

const TYPE = { TXT: 16, CNAME: 5, MX: 15 } as const

function stubResolver(zone: Zone) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input))
      const name = url.searchParams.get('name') ?? ''
      const type = url.searchParams.get('type') ?? 'TXT'
      const answer = zone[`${name}/${type}`]
      if (answer === 'boom') throw new TypeError('fetch failed')
      if (typeof answer === 'number') {
        return new Response('resolver is unwell', { status: answer })
      }
      return Response.json(answer ?? { Status: 0, Answer: [] })
    }),
  )
}

/** A domain with exactly the rows a test wants to reason about. */
async function domainWith(
  name: string,
  records: { record: keyof typeof TYPE; name: string; value: string; match?: string }[],
): Promise<string> {
  const now = new Date().toISOString()
  const id = `dom_${name.replace(/\W/g, '').toUpperCase().padEnd(26, '0').slice(0, 26)}`
  await h.sql
    .prepare(
      `INSERT INTO domains (id, workspace_id, name, status, last_verified_at, created_at, updated_at)
       VALUES (?, 'ws_default', ?, 'verified', ?, ?, ?)`,
    )
    .bind(id, name, now, now, now)
    .run()
  let n = 0
  for (const r of records) {
    await h.sql
      .prepare(
        `INSERT INTO domain_dns_records
           (id, workspace_id, domain_id, record, name, value, provider, purpose, origin,
            match_mode, status)
         VALUES (?, 'ws_default', ?, ?, ?, ?, 'cloudflare', 'because', 'copy', ?, 'verified')`,
      )
      .bind(`${id}:r${n++}`, id, r.record, r.name, r.value, r.match ?? 'exact')
      .run()
  }
  return id
}

const verify = async (id: string) => {
  const res = await h.fetch(`/v1/domains/${id}/verify`, { method: 'POST', cookie })
  expect(res.status).toBe(200)
  return (await res.json()) as {
    status: string
    dkim_ready: boolean
    spf_ready: boolean
    checked: { total: number; resolved: number; errored: number; first_error?: string | null }
    records: { name: string; status: string; error?: string | null; found?: string | null }[]
  }
}

describe('a lookup that did not happen', () => {
  it('reads as error, never as the status the row happened to be carrying', async () => {
    const id = await domainWith('acme.dev', [
      { record: 'TXT', name: 'acme.dev', value: 'v=spf1 include:_spf.mx.cloudflare.net ~all' },
    ])
    stubResolver({ 'acme.dev/TXT': 'boom' })

    const body = await verify(id)
    expect(body.records[0]?.status).toBe('error')
    expect(body.records[0]?.error).toContain('fetch failed')
    expect(body.status).not.toBe('verified')
    expect(body.checked).toMatchObject({ total: 1, resolved: 0, errored: 1 })
    expect(body.checked.first_error).toContain('fetch failed')
  })

  it('treats a resolver that answers 500 as an error, not as an empty zone', async () => {
    const id = await domainWith('acme.dev', [
      { record: 'TXT', name: 'acme.dev', value: 'v=spf1 ~all' },
    ])
    stubResolver({ 'acme.dev/TXT': 500 })

    const body = await verify(id)
    expect(body.records[0]?.status).toBe('error')
    expect(body.records[0]?.error).toContain('500')
  })

  it('separates SERVFAIL, which tells us nothing, from NXDOMAIN, which is an answer', async () => {
    const id = await domainWith('acme.dev', [
      { record: 'TXT', name: 'acme.dev', value: 'v=spf1 ~all' },
    ])

    stubResolver({ 'acme.dev/TXT': { Status: 2 } })
    expect((await verify(id)).records[0]?.status).toBe('error')

    // NXDOMAIN: the name genuinely does not exist, so the record is simply not
    // published yet — pending, and the reader's own zone to fix.
    stubResolver({ 'acme.dev/TXT': { Status: 3 } })
    expect((await verify(id)).records[0]?.status).toBe('pending')
  })

  it('never rolls a domain whose every row errored up to verified', async () => {
    const id = await domainWith('acme.dev', [
      { record: 'TXT', name: 'acme.dev', value: 'v=spf1 ~all' },
      { record: 'CNAME', name: 'k1._domainkey.acme.dev', value: 'k1.dkim.acme.dev' },
    ])
    stubResolver({ 'acme.dev/TXT': 'boom', 'k1._domainkey.acme.dev/CNAME': 'boom' })

    const body = await verify(id)
    expect(body.status).not.toBe('verified')
    expect(body.dkim_ready).toBe(false)
    const row = await h.sql
      .prepare('SELECT status, last_verified_at FROM domains WHERE id = ?')
      .bind(id)
      .first<{ status: string; last_verified_at: string | null }>()
    expect(row?.status).not.toBe('verified')
  })
})

describe('matchers that used to pass on strings they had not matched', () => {
  it('does not accept include:smtp in place of include:smtp-relay.example.com', async () => {
    // The include extractor's character class excluded `-`, so the required
    // include was truncated at the hyphen and then substring-matched: any zone
    // publishing `include:smtp` at all verified a record it did not carry.
    const id = await domainWith('acme.dev', [
      {
        record: 'TXT',
        name: 'acme.dev',
        value: 'v=spf1 include:smtp-relay.example.com ~all',
        match: 'include',
      },
    ])
    stubResolver({
      'acme.dev/TXT': {
        Status: 0,
        Answer: [{ name: 'acme.dev', type: TYPE.TXT, data: '"v=spf1 include:smtp ~all"' }],
      },
    })
    expect((await verify(id)).records[0]?.status).toBe('failed')

    stubResolver({
      'acme.dev/TXT': {
        Status: 0,
        Answer: [
          {
            name: 'acme.dev',
            type: TYPE.TXT,
            data: '"v=spf1 include:smtp-relay.example.com include:other.example ~all"',
          },
        ],
      },
    })
    expect((await verify(id)).records[0]?.status).toBe('verified')
  })

  it('reads the exchange out of an MX answer instead of the priority', async () => {
    // `canonical()` strips whitespace, so splitting the canonical form on a
    // space could never find the exchange; and this branch ran before
    // `match_mode` was read, which made a provider's prefix MX dead.
    const id = await domainWith('acme.dev', [
      { record: 'MX', name: 'acme.dev', value: 'mx.cloudflare.net', match: 'prefix' },
    ])
    stubResolver({
      'acme.dev/MX': {
        Status: 0,
        Answer: [{ name: 'acme.dev', type: TYPE.MX, data: '10 route1.mx.cloudflare.net.' }],
      },
    })
    expect((await verify(id)).records[0]?.status).toBe('verified')
  })

  it('is not ready for DKIM when one of two keys fails', async () => {
    // `some` here meant a half-published key pair reported working DKIM.
    const id = await domainWith('acme.dev', [
      { record: 'CNAME', name: 'k1._domainkey.acme.dev', value: 'k1.dkim.example.com' },
      { record: 'CNAME', name: 'k2._domainkey.acme.dev', value: 'k2.dkim.example.com' },
    ])
    stubResolver({
      'k1._domainkey.acme.dev/CNAME': {
        Status: 0,
        Answer: [
          { name: 'k1._domainkey.acme.dev', type: TYPE.CNAME, data: 'k1.dkim.example.com.' },
        ],
      },
      'k2._domainkey.acme.dev/CNAME': { Status: 0, Answer: [] },
    })

    const body = await verify(id)
    expect(body.dkim_ready).toBe(false)
    expect(body.status).not.toBe('verified')
  })
})

describe('a rewritten record set', () => {
  it('demotes the domain rather than leaving verified over rows nobody has checked', async () => {
    // `writeRecords` deletes and re-inserts every row as `not_started`. It is
    // called on a provider change; the domain's own `status` used to be left
    // alone, which is precisely the "it still says verified but the table below
    // says otherwise" report.
    const created = await h.fetch('/v1/domains', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ name: 'rewrite.dev' }),
    })
    const { id } = (await created.json()) as { id: string }
    await h.sql
      .prepare("UPDATE domains SET status = 'verified', last_verified_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), id)
      .run()

    const patched = await h.fetch(`/v1/domains/${id}`, {
      method: 'PATCH',
      cookie,
      body: JSON.stringify({ provider: 'ses' }),
    })
    expect(patched.status).toBe(200)

    const row = await h.sql
      .prepare('SELECT status, last_verified_at FROM domains WHERE id = ?')
      .bind(id)
      .first<{ status: string; last_verified_at: string | null }>()
    expect(row?.status).toBe('not_started')
    expect(row?.last_verified_at).toBeNull()

    const rows = await h.sql
      .prepare('SELECT status FROM domain_dns_records WHERE domain_id = ?')
      .bind(id)
      .all<{ status: string }>()
    expect(rows.results.every((r) => r.status === 'not_started')).toBe(true)
  })
})

/**
 * The receiving preflight.
 *
 * Same vocabulary as the sending checks, and for the same reason: an operator
 * whose catch-all is bound but whose MX still points at Google needs to be
 * told that, and a resolver that would not answer must never launder into a
 * pass.
 */
describe('the MX preflight', () => {
  const check = async (id: string) => {
    const res = await h.fetch(`/v1/domains/${id}/receiving-check`, { method: 'POST', cookie })
    expect(res.status).toBe(200)
    return (await res.json()) as {
      status: string
      found: string | null
      detail: string
      mailboxes: { count: number; catch_all: string | null }
    }
  }

  it('reports error when the resolver will not answer, never a pass', async () => {
    const id = await domainWith('acme.dev', [])
    stubResolver({ 'acme.dev/MX': 'boom' })

    const body = await check(id)
    expect(body.status).toBe('error')
    expect(body.found).toBeNull()
    expect(body.detail).toContain('not evidence')
  })

  it('recognises Cloudflare Email Routing', async () => {
    const id = await domainWith('acme.dev', [])
    stubResolver({
      'acme.dev/MX': {
        Status: 0,
        Answer: [{ name: 'acme.dev', type: TYPE.MX, data: '10 route1.mx.cloudflare.net.' }],
      },
    })

    const body = await check(id)
    expect(body.status).toBe('verified')
  })

  it('says so when the mail goes somewhere else', async () => {
    const id = await domainWith('acme.dev', [])
    stubResolver({
      'acme.dev/MX': {
        Status: 0,
        Answer: [{ name: 'acme.dev', type: TYPE.MX, data: '1 aspmx.l.google.com.' }],
      },
    })

    const body = await check(id)
    expect(body.status).toBe('failed')
    expect(body.found).toContain('google')
  })

  it('calls a domain with no MX at all pending, not failed', async () => {
    const id = await domainWith('acme.dev', [])
    stubResolver({ 'acme.dev/MX': { Status: 0, Answer: [] } })

    const body = await check(id)
    expect(body.status).toBe('pending')
    expect(body.mailboxes.count).toBe(0)
  })
})
