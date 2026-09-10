import { base64url } from '@mailysend/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyIdToken } from '../src/server/api/auth-oidc.ts'
import { runWithEnv } from '../src/server/env.ts'
import { claimFor, type Harness, harness } from './harness.ts'

/**
 * OpenID Connect.
 *
 * Every case here is a way in that a plausible implementation leaves open: an
 * unverified signature, a token minted for a different application at the same
 * issuer, a replayed `nonce`, a `state` that did not come from this browser, an
 * address the provider will not vouch for. They are written as attacks rather
 * than as features because a sign-in door that fails open is not a smaller bug
 * than one that fails closed.
 */

const ISSUER = 'https://issuer.example'
const CLIENT_ID = 'ms-test-client'

let h: Harness
let keys: CryptoKeyPair
let jwk: JsonWebKey

const OIDC_ENV = {
  MS_OIDC_ISSUER: ISSUER,
  MS_OIDC_CLIENT_ID: CLIENT_ID,
  MS_OIDC_CLIENT_SECRET: 'secret',
  MS_OIDC_LABEL: 'Example SSO',
}

beforeEach(async () => {
  keys = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  jwk = await crypto.subtle.exportKey('jwk', keys.publicKey)
  jwk.kid = 'test-key'
  h = await harness(OIDC_ENV as never)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Mints an ID token the way a real provider would, so a test can then break it. */
async function idToken(
  claims: Record<string, unknown> = {},
  opts: { key?: CryptoKey; alg?: string } = {},
): Promise<string> {
  const header = base64url.encode(JSON.stringify({ alg: opts.alg ?? 'RS256', kid: 'test-key' }))
  const payload = base64url.encode(
    JSON.stringify({
      iss: ISSUER,
      aud: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000),
      email: 'owner@acme.dev',
      email_verified: true,
      nonce: 'n1',
      ...claims,
    }),
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    opts.key ?? keys.privateKey,
    new TextEncoder().encode(`${header}.${payload}`) as unknown as ArrayBuffer,
  )
  return `${header}.${payload}.${base64url.encode(new Uint8Array(signature))}`
}

/** Stands in for the provider: discovery, JWKS and the token endpoint. */
function stubProvider(overrides: { token?: () => Promise<Response> } = {}) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.endsWith('/.well-known/openid-configuration')) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
      })
    }
    if (url === `${ISSUER}/jwks`) return Response.json({ keys: [jwk] })
    if (url === `${ISSUER}/token` && overrides.token) return overrides.token()
    return new Response('unexpected', { status: 500 })
  })
}

const verify = (token: string, jwksUri = `${ISSUER}/jwks`) =>
  runWithEnv(h.env, { waitUntil: () => {} }, () =>
    verifyIdToken(token, { issuer: ISSUER, clientId: CLIENT_ID }, jwksUri),
  )

describe('the ID token', () => {
  beforeEach(() => stubProvider())

  it('accepts a token this provider actually signed', async () => {
    await expect(verify(await idToken())).resolves.toMatchObject({ email: 'owner@acme.dev' })
  })

  it('rejects a token whose payload was edited after signing', async () => {
    const token = await idToken()
    const [header, , signature] = token.split('.')
    const tampered = base64url.encode(
      JSON.stringify({
        iss: ISSUER,
        aud: CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 300,
        email: 'attacker@acme.dev',
        email_verified: true,
      }),
    )
    await expect(verify(`${header}.${tampered}.${signature}`)).rejects.toThrow(/signature/i)
  })

  it('rejects a token signed by somebody else’s key', async () => {
    const other = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair
    await expect(verify(await idToken({}, { key: other.privateKey }))).rejects.toThrow(/signature/i)
  })

  it('refuses alg: none rather than treating it as unsigned-but-fine', async () => {
    const header = base64url.encode(JSON.stringify({ alg: 'none' }))
    const payload = base64url.encode(
      JSON.stringify({ iss: ISSUER, aud: CLIENT_ID, email: 'x@y.z' }),
    )
    await expect(verify(`${header}.${payload}.`)).rejects.toThrow(/well-formed|Unsupported/i)
  })

  it('rejects a token minted for a different client at the same issuer', async () => {
    await expect(verify(await idToken({ aud: 'someone-elses-app' }))).rejects.toThrow(
      /different client/i,
    )
  })

  it('rejects a token from a different issuer', async () => {
    await expect(verify(await idToken({ iss: 'https://evil.example' }))).rejects.toThrow(
      /issued by somebody else/i,
    )
  })

  it('rejects an expired token', async () => {
    await expect(
      verify(await idToken({ exp: Math.floor(Date.now() / 1000) - 3600 })),
    ).rejects.toThrow(/expired/i)
  })
})

describe('the flow', () => {
  const start = () => h.fetch('/v1/auth/oidc/start')

  it('redirects to the provider with PKCE S256 and a state', async () => {
    stubProvider()
    const res = await start()
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location') ?? '')
    expect(location.origin + location.pathname).toBe(`${ISSUER}/authorize`)
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    expect(location.searchParams.get('code_challenge')).toBeTruthy()
    // The verifier itself must never travel to the provider at this step.
    expect(location.searchParams.get('code_verifier')).toBeNull()
    expect(location.searchParams.get('state')).toBeTruthy()
    expect(location.searchParams.get('nonce')).toBeTruthy()
    expect(res.headers.get('set-cookie')).toContain('ms_oidc=')
  })

  const beginFlow = async () => {
    stubProvider()
    const started = await start()
    const location = new URL(started.headers.get('location') ?? '')
    const cookie = started.headers.get('set-cookie')?.split(';')[0] ?? ''
    return {
      cookie,
      state: location.searchParams.get('state') ?? '',
      nonce: location.searchParams.get('nonce') ?? '',
    }
  }

  it('signs in and claims an unclaimed instance', async () => {
    const flow = await beginFlow()
    stubProvider({
      token: async () => Response.json({ id_token: await idToken({ nonce: flow.nonce }) }),
    })
    const res = await h.fetch(`/v1/auth/oidc/callback?code=abc&state=${flow.state}`, {
      cookie: flow.cookie,
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/app')
    expect(res.headers.get('set-cookie')).toContain('ms_session=')

    const user = await h.sql
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind('owner@acme.dev')
      .first<{ id: string }>()
    expect(user).toBeTruthy()
  })

  it('rejects a state that did not come from this browser', async () => {
    const flow = await beginFlow()
    stubProvider({
      token: async () => Response.json({ id_token: await idToken({ nonce: flow.nonce }) }),
    })
    const res = await h.fetch('/v1/auth/oidc/callback?code=abc&state=not-the-one', {
      cookie: flow.cookie,
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await res.text()).toMatch(/state did not match/i)
  })

  it('rejects a callback with no flow cookie at all', async () => {
    stubProvider()
    const res = await h.fetch('/v1/auth/oidc/callback?code=abc&state=whatever')
    expect(await res.text()).toMatch(/expired or did not start here/i)
  })

  it('rejects a token minted for a different attempt (nonce replay)', async () => {
    const flow = await beginFlow()
    // A token from an earlier, legitimate flow: correct signature, correct
    // audience, wrong nonce. Without the nonce check it would be accepted.
    stubProvider({
      token: async () => Response.json({ id_token: await idToken({ nonce: 'an-older-flow' }) }),
    })
    const res = await h.fetch(`/v1/auth/oidc/callback?code=abc&state=${flow.state}`, {
      cookie: flow.cookie,
    })
    expect(await res.text()).toMatch(/different attempt/i)
  })

  it('refuses an address the provider has not verified', async () => {
    const flow = await beginFlow()
    stubProvider({
      token: async () =>
        Response.json({ id_token: await idToken({ nonce: flow.nonce, email_verified: false }) }),
    })
    const res = await h.fetch(`/v1/auth/oidc/callback?code=abc&state=${flow.state}`, {
      cookie: flow.cookie,
    })
    expect(await res.text()).toMatch(/has not verified/i)
  })
})

describe('who is admitted', () => {
  it('admits an allowlisted domain and refuses one outside it', async () => {
    h = await harness({ ...OIDC_ENV, MS_OIDC_ALLOWED_DOMAINS: 'acme.dev' } as never)
    stubProvider()
    const started = await h.fetch('/v1/auth/oidc/start')
    const location = new URL(started.headers.get('location') ?? '')
    const cookie = started.headers.get('set-cookie')?.split(';')[0] ?? ''
    const state = location.searchParams.get('state') ?? ''
    const nonce = location.searchParams.get('nonce') ?? ''

    stubProvider({
      token: async () =>
        Response.json({ id_token: await idToken({ nonce, email: 'someone@evil.example' }) }),
    })
    const refused = await h.fetch(`/v1/auth/oidc/callback?code=abc&state=${state}`, { cookie })
    expect(await refused.text()).toMatch(/not in a domain this instance admits/i)

    // The same flow, with an address inside the allowlist, goes through.
    stubProvider({
      token: async () =>
        Response.json({ id_token: await idToken({ nonce, email: 'someone@acme.dev' }) }),
    })
    const admitted = await h.fetch(`/v1/auth/oidc/callback?code=abc&state=${state}`, { cookie })
    expect(admitted.status).toBe(302)
    expect(admitted.headers.get('set-cookie')).toContain('ms_session=')
  })

  it('refuses a non-member once the instance is claimed and auto-provision is off', async () => {
    await claimFor(h)
    stubProvider()
    const started = await h.fetch('/v1/auth/oidc/start')
    const location = new URL(started.headers.get('location') ?? '')
    const cookie = started.headers.get('set-cookie')?.split(';')[0] ?? ''
    const state = location.searchParams.get('state') ?? ''
    const nonce = location.searchParams.get('nonce') ?? ''

    stubProvider({
      token: async () =>
        Response.json({ id_token: await idToken({ nonce, email: 'stranger@acme.dev' }) }),
    })
    const res = await h.fetch(`/v1/auth/oidc/callback?code=abc&state=${state}`, { cookie })
    expect(await res.text()).toMatch(/not a member of this instance/i)
  })

  it('respects MS_OWNER_EMAIL while the instance is unclaimed', async () => {
    h = await harness({ ...OIDC_ENV, MS_OWNER_EMAIL: 'boss@acme.dev' } as never)
    stubProvider()
    const started = await h.fetch('/v1/auth/oidc/start')
    const location = new URL(started.headers.get('location') ?? '')
    const cookie = started.headers.get('set-cookie')?.split(';')[0] ?? ''
    const state = location.searchParams.get('state') ?? ''
    const nonce = location.searchParams.get('nonce') ?? ''

    stubProvider({
      token: async () => Response.json({ id_token: await idToken({ nonce }) }),
    })
    const res = await h.fetch(`/v1/auth/oidc/callback?code=abc&state=${state}`, { cookie })
    expect(await res.text()).toMatch(/reserved for a different address/i)
  })
})

describe('/v1/instance', () => {
  it('advertises the button only when the configuration is complete', async () => {
    const on = (await (await h.fetch('/v1/instance')).json()) as {
      auth: { oidc: boolean; oidc_label: string | null }
    }
    expect(on.auth.oidc).toBe(true)
    expect(on.auth.oidc_label).toBe('Example SSO')

    // A half-configured instance is not a configured one: an issuer with no
    // client secret would render a button that cannot complete.
    const partial = await harness({ MS_OIDC_ISSUER: ISSUER } as never)
    const off = (await (await partial.fetch('/v1/instance')).json()) as {
      auth: { oidc: boolean }
    }
    expect(off.auth.oidc).toBe(false)
  })
})
