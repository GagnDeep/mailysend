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

/**
 * Tracking is off unless somebody asked for it.
 *
 * Both switches change the message in a way the recipient can see — a pixel
 * their client fetches from us, and links that resolve through our redirector
 * — and both used to be on from the moment a domain was created. That is a
 * default nobody consented to, so it is now asserted in three places at once:
 * the response body, the row the INSERT actually wrote, and the column default
 * the INSERT relies on.
 */
describe('what a new domain starts with', () => {
  it('creates a domain with neither tracking switch on', async () => {
    const created = await h.fetch('/v1/domains', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ name: 'quiet.dev' }),
    })
    expect(created.status).toBe(201)
    const body = (await created.json()) as {
      id: string
      open_tracking: boolean
      click_tracking: boolean
    }
    expect(body.open_tracking).toBe(false)
    expect(body.click_tracking).toBe(false)

    // The response is a literal; this is the row, which is what the send path
    // reads. The two disagreeing is exactly the bug this guards.
    const row = await h.sql
      .prepare('SELECT open_tracking, click_tracking FROM domains WHERE id = ?')
      .bind(body.id)
      .first<{ open_tracking: number; click_tracking: number }>()
    expect(row?.open_tracking).toBe(0)
    expect(row?.click_tracking).toBe(0)
  })

  it('takes the column default, not a value the INSERT names', async () => {
    // The INSERT does not list either column, so the migration's default is
    // the whole of the behaviour. A rebuild that dropped it would pass the test
    // above only if the response literal were wrong in the same direction.
    await h.sql
      .prepare(
        `INSERT INTO domains (id, workspace_id, name, status, region, dkim_selector,
                              custom_return_path, created_at, updated_at)
         VALUES ('dom_default', 'ws_default', 'bare.dev', 'not_started', 'global', 'ms1',
                 'cf-bounce', ?, ?)`,
      )
      .bind(new Date().toISOString(), new Date().toISOString())
      .run()
    const row = await h.sql
      .prepare('SELECT open_tracking, click_tracking FROM domains WHERE id = ?')
      .bind('dom_default')
      .first<{ open_tracking: number; click_tracking: number }>()
    expect(row?.open_tracking).toBe(0)
    expect(row?.click_tracking).toBe(0)
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
      checked_at: string
      mailboxes: { count: number; catch_all: string | null }
    }
  }

  /** What the domain row remembers about receiving, after a check. */
  const remembered = async (id: string) =>
    await h.sql
      .prepare(
        'SELECT receiving_mx_status, receiving_mx_found, receiving_checked_at FROM domains WHERE id = ?',
      )
      .bind(id)
      .first<{
        receiving_mx_status: string | null
        receiving_mx_found: string | null
        receiving_checked_at: string | null
      }>()

  it('reports error when the resolver will not answer, never a pass', async () => {
    const id = await domainWith('acme.dev', [])
    stubResolver({ 'acme.dev/MX': 'boom' })

    const body = await check(id)
    expect(body.status).toBe('error')
    expect(body.found).toBeNull()
    expect(body.detail).toContain('not evidence')
    expect(await remembered(id)).toMatchObject({ receiving_mx_status: 'error' })
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
    const row = await remembered(id)
    expect(row?.receiving_mx_status).toBe('verified')
    expect(row?.receiving_mx_found).toContain('mx.cloudflare.net')
    expect(row?.receiving_checked_at).toBe(body.checked_at)
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
    expect(await remembered(id)).toMatchObject({ receiving_mx_status: 'failed' })
  })

  it('calls a domain with no MX at all pending, not failed', async () => {
    const id = await domainWith('acme.dev', [])
    stubResolver({ 'acme.dev/MX': { Status: 0, Answer: [] } })

    const body = await check(id)
    expect(body.status).toBe('pending')
    expect(body.mailboxes.count).toBe(0)
    expect(await remembered(id)).toMatchObject({ receiving_mx_status: 'pending' })
  })

  it('lets an error overwrite a previous pass, because we no longer know', async () => {
    const id = await domainWith('acme.dev', [])
    stubResolver({
      'acme.dev/MX': {
        Status: 0,
        Answer: [{ name: 'acme.dev', type: TYPE.MX, data: '10 route1.mx.cloudflare.net.' }],
      },
    })
    expect((await check(id)).status).toBe('verified')

    stubResolver({ 'acme.dev/MX': 'boom' })
    expect((await check(id)).status).toBe('error')
    // Not left reading `verified`: a resolver that would not answer means the
    // last thing we established is no longer established.
    expect(await remembered(id)).toMatchObject({ receiving_mx_status: 'error' })
  })
})

/**
 * `GET /v1/domains/:id` answers both halves of the question the page asks.
 *
 * It used to answer neither: no statement about receiving at all, and `checked`
 * only on a verify response — so a page load could not distinguish a domain
 * nobody had looked at from one where four of six records were missing, and had
 * nothing to say about receiving but "press this button".
 */
describe('what a page load knows', () => {
  const get = async (id: string) => {
    const res = await h.fetch(`/v1/domains/${id}`, { cookie })
    expect(res.status).toBe(200)
    return (await res.json()) as {
      sending_ready: boolean
      checked: { total: number; resolved: number; errored: number; first_error?: string | null }
      receiving: {
        mx_status: string | null
        mx_found: string | null
        checked_at: string | null
        mailboxes: { count: number; catch_all: string | null }
        catch_all: { observable: boolean; detail: string }
        last_inbound_at: string | null
      }
    }
  }

  it('resolves nothing of its own — the answer is whatever was last written', async () => {
    const id = await domainWith('acme.dev', [
      { record: 'TXT', name: 'acme.dev', value: 'v=spf1 ~all' },
    ])
    // No resolver stubbed at all. A GET that reached the network would throw.
    const body = await get(id)
    expect(body.receiving.mx_status).toBeNull()
    expect(body.receiving.checked_at).toBeNull()
    // Null is "nobody has looked", which is why a never-checked row counts as
    // resolved: zero, not one.
    expect(body.checked).toMatchObject({ total: 1, resolved: 0, errored: 0 })
  })

  it('carries the last MX observation without re-resolving it', async () => {
    const id = await domainWith('acme.dev', [])
    stubResolver({
      'acme.dev/MX': {
        Status: 0,
        Answer: [{ name: 'acme.dev', type: TYPE.MX, data: '10 route1.mx.cloudflare.net.' }],
      },
    })
    await h.fetch(`/v1/domains/${id}/receiving-check`, { method: 'POST', cookie })

    const body = await get(id)
    expect(body.receiving.mx_status).toBe('verified')
    expect(body.receiving.mx_found).toContain('mx.cloudflare.net')
    expect(body.receiving.checked_at).not.toBeNull()
    expect(body.receiving.last_inbound_at).toBeNull()
  })

  it('never claims the domain is ready to receive, whatever it observed', async () => {
    // Cloudflare's Email Routing catch-all rule is not readable over its API,
    // so no combination of observations justifies a boolean here. A future
    // field named `ready` under `receiving` would be a claim the server cannot
    // support — this is the test that says so.
    const id = await domainWith('acme.dev', [])
    stubResolver({
      'acme.dev/MX': {
        Status: 0,
        Answer: [{ name: 'acme.dev', type: TYPE.MX, data: '10 route1.mx.cloudflare.net.' }],
      },
    })
    await h.fetch(`/v1/domains/${id}/receiving-check`, { method: 'POST', cookie })

    const body = (await (await h.fetch(`/v1/domains/${id}`, { cookie })).json()) as Record<
      string,
      unknown
    >
    expect(Object.keys(body)).not.toContain('receiving_ready')
    expect(JSON.stringify(body.receiving)).not.toMatch(/"ready"/)
    expect((body.receiving as { catch_all: { observable: boolean } }).catch_all.observable).toBe(
      false,
    )
  })

  it('counts a partial verify as partial, rather than as a domain that failed', async () => {
    const id = await domainWith('acme.dev', [
      { record: 'TXT', name: 'acme.dev', value: 'v=spf1 include:_spf.mx.cloudflare.net ~all' },
      { record: 'TXT', name: 'ms1._domainkey.acme.dev', value: 'v=DKIM1; p=AAAA', match: 'prefix' },
    ])
    stubResolver({
      'acme.dev/TXT': {
        Status: 0,
        Answer: [
          {
            name: 'acme.dev',
            type: TYPE.TXT,
            data: '"v=spf1 include:_spf.mx.cloudflare.net ~all"',
          },
        ],
      },
      'ms1._domainkey.acme.dev/TXT': 'boom',
    })
    await h.fetch(`/v1/domains/${id}/verify`, { method: 'POST', cookie })

    const body = await get(id)
    expect(body.checked.total).toBe(2)
    expect(body.checked.resolved + body.checked.errored).toBe(2)
    expect(body.checked.errored).toBe(1)
    expect(body.checked.first_error).toContain('fetch failed')
    // One record resolved and one could not be looked up at all, which is not
    // a domain anybody should be told to send from.
    expect(body.sending_ready).toBe(false)
  })
})
