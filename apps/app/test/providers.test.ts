import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptCredentials } from '../src/server/services/providers.ts'
import { claimFor, type Harness, harness, sessionFor } from './harness.ts'

/**
 * Transports, and the records a domain derives from them.
 *
 * `provider_configs` had no write path at all until this release — the table
 * existed, `encryptCredentials` existed, and nothing ever called it — so the
 * Settings radio was decoration and every domain's records were the union
 * across whatever the router happened to fall back to. Two of those transports
 * each want an apex `v=spf1` record, and two apex SPF records is a permanent
 * error at every receiver that checks. These tests hold the three properties
 * that were quietly false: secrets go in and never come back, `verify()`'s
 * three answers reach the screen unchanged, and a domain publishes one
 * transport's records rather than everybody's.
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

const put = (name: string, body: unknown) =>
  h.fetch(`/v1/providers/${name}`, { method: 'PUT', cookie, body: JSON.stringify(body) })

describe('credentials', () => {
  it('stores a secret as ciphertext and never returns it', async () => {
    const res = await put('resend', { credentials: { api_key: 're_super_secret_value' } })
    expect(res.status).toBe(200)
    const saved = (await res.json()) as { credentials_set: string[] }

    // The response says *which* fields are set, so a form can render "•••• set".
    expect(saved.credentials_set).toEqual(['api_key'])
    expect(JSON.stringify(saved)).not.toContain('re_super_secret_value')

    const listed = await (await h.fetch('/v1/providers', { cookie })).text()
    expect(listed).toContain('api_key')
    expect(listed).not.toContain('re_super_secret_value')

    // And at rest it is ciphertext, not a value somebody with the database has.
    const row = await h.sql
      .prepare("SELECT credentials FROM provider_configs WHERE provider = 'resend'")
      .first<{ credentials: string }>()
    expect(row?.credentials).toBeTruthy()
    expect(row?.credentials).not.toContain('re_super_secret_value')
    // It round-trips, which is the half that matters to the send path.
    await expect(decryptCredentials(row?.credentials as string, h.env)).resolves.toEqual({
      api_key: 're_super_secret_value',
    })
  })

  it('a partial update does not wipe the secret it did not mention', async () => {
    await put('ses', {
      credentials: { access_key_id: 'AKIAEXAMPLE', secret_access_key: 'shhh-do-not-lose-me' },
    })
    // The form sends back only the field somebody retyped.
    const res = await put('ses', { credentials: { access_key_id: 'AKIAROTATED' } })
    const saved = (await res.json()) as { credentials_set: string[] }
    expect(saved.credentials_set.sort()).toEqual(['access_key_id', 'secret_access_key'])

    const row = await h.sql
      .prepare("SELECT credentials FROM provider_configs WHERE provider = 'ses'")
      .first<{ credentials: string }>()
    await expect(decryptCredentials(row?.credentials as string, h.env)).resolves.toEqual({
      access_key_id: 'AKIAROTATED',
      secret_access_key: 'shhh-do-not-lose-me',
    })
  })

  it('an empty string is how a field is cleared', async () => {
    await put('resend', { credentials: { api_key: 're_x' } })
    const res = await put('resend', { credentials: { api_key: '' } })
    expect(((await res.json()) as { credentials_set: string[] }).credentials_set).toEqual([])
  })

  it('refuses a transport it does not have', async () => {
    expect((await put('sendgrid', { enabled: true })).status).toBe(422)
  })
})

describe('verify(), all three answers', () => {
  it('reports ok when the transport actually answered', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }))
    await put('resend', { credentials: { api_key: 're_live' } })
    const body = (await (
      await h.fetch('/v1/providers/resend/test', { method: 'POST', cookie })
    ).json()) as { status: string }
    expect(body.status).toBe('ok')
  })

  it('reports failed when it answered badly', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 401 }))
    await put('resend', { credentials: { api_key: 're_wrong' } })
    const body = (await (
      await h.fetch('/v1/providers/resend/test', { method: 'POST', cookie })
    ).json()) as { status: string; detail: string }
    expect(body.status).toBe('failed')
    expect(body.detail).toContain('401')
  })

  it('keeps unknown as unknown rather than promoting a binding to ok', async () => {
    // A `send_email` binding is present on every Worker that declares one,
    // configured or not. Reporting `ok` from its mere presence is the lie the
    // three-state result exists to prevent.
    const bound = await harness({ SEND_EMAIL: { send: async () => {} } } as never)
    const boundCookie = await sessionFor(bound, await claimFor(bound))
    const body = (await (
      await bound.fetch('/v1/providers/cloudflare/test', { method: 'POST', cookie: boundCookie })
    ).json()) as { status: string; detail: string }
    expect(body.status).toBe('unknown')
    expect(body.detail).toContain('first send')
  })

  it('says nothing is configured rather than guessing', async () => {
    const body = (await (
      await h.fetch('/v1/providers/smtp/test', { method: 'POST', cookie })
    ).json()) as { status: string; detail: string }
    expect(body.status).toBe('failed')
    expect(body.detail).toContain('nothing to check')
  })
})

describe('the catalog', () => {
  it('states each transport’s caveats rather than hiding them in a docs page', async () => {
    const body = (await (await h.fetch('/v1/providers/catalog', { cookie })).json()) as {
      data: { provider: string; caveats: string[]; max_message_bytes?: number }[]
    }
    const ses = body.data.find((entry) => entry.provider === 'ses')
    expect(ses?.caveats.join(' ')).toContain('sandbox')
    const cloudflare = body.data.find((entry) => entry.provider === 'cloudflare')
    expect(cloudflare?.caveats.join(' ')).toContain('5 MiB')
  })
})

describe('a domain’s records come from its bound transport', () => {
  const recordsFor = async (id: string) => {
    const body = (await (await h.fetch(`/v1/domains/${id}`, { cookie })).json()) as {
      records: { record: string; name: string; value: string; provider: string }[]
    }
    return body.records
  }

  const create = (name: string, provider?: string) =>
    h.fetch('/v1/domains', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ name, ...(provider ? { provider } : {}) }),
    })

  beforeEach(async () => {
    // Three transports configured, two of which each want an apex `v=spf1` —
    // exactly the shape that used to publish two apex SPF records.
    await put('cloudflare', { enabled: true })
    await put('ses', {
      enabled: true,
      credentials: { access_key_id: 'AKIA', secret_access_key: 'secret' },
      config: { region: 'us-east-1' },
    })
    await put('resend', { enabled: true, credentials: { api_key: 're_x' } })
  })

  it('publishes only the bound transport’s records', async () => {
    const created = (await (await create('bound.dev', 'ses')).json()) as { id: string }
    const records = await recordsFor(created.id)
    expect(records.length).toBeGreaterThan(0)
    // Every record is SES's or shared; nothing belongs to a transport this
    // domain does not send through.
    expect(records.every((r) => r.provider === 'ses' || r.provider === 'all')).toBe(true)
    expect(records.some((r) => r.provider === 'resend')).toBe(false)
    // SES's second SPF record is on the MAIL FROM subdomain, which is a
    // different name and therefore legal; what must never appear twice is the
    // apex.
    const apexSpf = records.filter((r) => r.name === 'bound.dev' && r.value.startsWith('v=spf1'))
    expect(apexSpf).toHaveLength(1)
    expect(apexSpf[0]?.value).toContain('amazonses.com')
    expect(apexSpf[0]?.value).not.toContain('cloudflare')
  })

  it('re-derives the records when the binding changes', async () => {
    const created = (await (await create('rebound.dev', 'ses')).json()) as { id: string }
    const before = await recordsFor(created.id)
    await h.fetch(`/v1/domains/${created.id}`, {
      method: 'PATCH',
      cookie,
      body: JSON.stringify({ provider: 'resend' }),
    })
    const after = await recordsFor(created.id)
    expect(after.some((r) => r.provider === 'resend')).toBe(true)
    expect(after.some((r) => r.provider === 'ses')).toBe(false)
    expect(after).not.toEqual(before)
  })

  it('merges the union into one legal SPF record when nothing is bound', async () => {
    const created = (await (await create('unbound.dev')).json()) as { id: string }
    const records = await recordsFor(created.id)
    const spf = records.filter(
      (r) => r.name === 'unbound.dev' && r.record === 'TXT' && r.value.startsWith('v=spf1'),
    )
    // RFC 7208 §3.2: a second v=spf1 record at the same name is a permerror,
    // not a fallback. One record, carrying both includes.
    expect(spf).toHaveLength(1)
    expect(spf[0]?.value).toMatch(/^v=spf1( \S+)+ [-~+?]?all$/)
    expect((spf[0]?.value.match(/all/g) ?? []).length).toBe(1)
    expect(spf[0]?.value).toContain('amazonses.com')
    expect(spf[0]?.value).toContain('_spf.mx.cloudflare.net')
    expect(spf[0]?.provider).toBe('all')
  })
})
