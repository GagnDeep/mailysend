import { apiError } from '@mailysend/contracts'
import { base64url, hmacHex, timingSafeEqual } from '@mailysend/core'
import { tenancyFor } from '../context.ts'
import { getEnv } from '../env.ts'
import { issueSession, normalizeEmail, sessionCookie } from '../session.ts'
import { createRouter } from './base.ts'

/**
 * OpenID Connect, as one more door rather than as a replacement for the others.
 *
 * The shape follows Cloudflare Access exactly, and for the same reason: the
 * identity is proven somewhere the operator already trusts, and what reaches us
 * is a token we must verify properly rather than a claim we may read. Every
 * check below exists because skipping it is a known way in — an unverified
 * signature lets anyone with a text editor sign in as anyone, a missing `nonce`
 * check lets a token be replayed, a missing `aud` check lets a token minted for
 * a different application at the same issuer be presented here, and a missing
 * `email_verified` check lets somebody register an address they do not own at a
 * provider that permits it.
 *
 * The button on the sign-in page renders only when this is configured, which is
 * the same rule that removed the fake Cloudflare Access button.
 */

const oidc = createRouter()

/** Ten minutes is longer than any human takes and shorter than any useful replay. */
const FLOW_TTL_MS = 10 * 60_000
const STATE_COOKIE = 'ms_oidc'
const DISCOVERY_TTL_SECONDS = 3600

export interface OidcConfig {
  issuer: string
  clientId: string
  clientSecret: string
  allowedDomains: string[]
  autoProvision: boolean
  label: string
}

/** Null when the instance has not configured it, which is what hides the button. */
export function oidcConfig(): OidcConfig | null {
  const env = getEnv()
  if (!env.MS_OIDC_ISSUER || !env.MS_OIDC_CLIENT_ID || !env.MS_OIDC_CLIENT_SECRET) return null
  return {
    issuer: env.MS_OIDC_ISSUER.replace(/\/$/, ''),
    clientId: env.MS_OIDC_CLIENT_ID,
    clientSecret: env.MS_OIDC_CLIENT_SECRET,
    allowedDomains: (env.MS_OIDC_ALLOWED_DOMAINS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
    autoProvision: env.MS_OIDC_AUTO_PROVISION === 'true',
    label: env.MS_OIDC_LABEL ?? 'single sign-on',
  }
}

interface Discovery {
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  issuer: string
}

/**
 * Discovery, cached in KV.
 *
 * The document changes about as often as the provider is reconfigured, and
 * fetching it on every sign-in adds a round trip to a hot path plus a hard
 * dependency on the provider being up at exactly the moment somebody clicks.
 */
export async function discover(issuer: string): Promise<Discovery> {
  const env = getEnv()
  const key = `oidc:discovery:${issuer}`
  const cached = await env.CACHE.get(key, 'json')
  if (cached) return cached as unknown as Discovery

  const response = await fetch(`${issuer}/.well-known/openid-configuration`)
  if (!response.ok) {
    throw apiError('not_implemented', {
      message: `The identity provider at ${issuer} did not return a discovery document (HTTP ${response.status}).`,
    })
  }
  const document = (await response.json()) as Discovery
  if (document.issuer.replace(/\/$/, '') !== issuer) {
    // A discovery document that names a different issuer is either a
    // misconfiguration or somebody else's document.
    throw apiError('not_implemented', {
      message: `That discovery document belongs to ${document.issuer}, not ${issuer}.`,
    })
  }
  await env.CACHE.put(key, JSON.stringify(document), { expirationTtl: DISCOVERY_TTL_SECONDS })
  return document
}

// ---------------------------------------------------------------------------
// The signed flow cookie
// ---------------------------------------------------------------------------

interface FlowState {
  state: string
  nonce: string
  verifier: string
  at: number
}

/**
 * `state`, `nonce` and the PKCE verifier travel in a signed cookie rather than
 * in a server-side table.
 *
 * There is nothing here worth a row: the whole value is meaningless ten minutes
 * later, and signing it means a tampered cookie is rejected without a lookup.
 */
async function sealFlow(flow: FlowState, secret: string): Promise<string> {
  const payload = base64url.encode(JSON.stringify(flow))
  return `${payload}.${await hmacHex(secret, payload)}`
}

async function openFlow(value: string | undefined, secret: string): Promise<FlowState | null> {
  if (!value) return null
  const [payload, signature] = value.split('.')
  if (!payload || !signature) return null
  if (!timingSafeEqual(signature, await hmacHex(secret, payload))) return null
  try {
    const flow = JSON.parse(base64url.decodeText(payload)) as FlowState
    return Date.now() - flow.at > FLOW_TTL_MS ? null : flow
  } catch {
    return null
  }
}

const flowCookie = (value: string, publicUrl: string, maxAge: number): string =>
  [
    `${STATE_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    // `Lax` and not `Strict`: the whole flow ends in a top-level redirect back
    // from the provider, which a Strict cookie would not accompany.
    'SameSite=Lax',
    publicUrl.startsWith('http://') ? '' : 'Secure',
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join('; ')

const randomToken = (): string => base64url.encode(crypto.getRandomValues(new Uint8Array(32)))

/** PKCE S256, per RFC 7636. Plain is not offered: it protects nothing. */
async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier) as unknown as ArrayBuffer,
  )
  return base64url.encode(new Uint8Array(digest))
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** `GET /v1/auth/oidc/start` — hand the browser to the provider. */
oidc.get('/start', async () => {
  const env = getEnv()
  const config = oidcConfig()
  if (!config) {
    throw apiError('not_implemented', {
      message:
        'Single sign-on is not configured on this instance. Set MS_OIDC_ISSUER, MS_OIDC_CLIENT_ID and MS_OIDC_CLIENT_SECRET, or sign in with a passkey.',
    })
  }

  const document = await discover(config.issuer)
  const flow: FlowState = {
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(),
    at: Date.now(),
  }

  const url = new URL(document.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', `${env.MS_PUBLIC_URL}/v1/auth/oidc/callback`)
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', flow.state)
  url.searchParams.set('nonce', flow.nonce)
  url.searchParams.set('code_challenge', await challengeFor(flow.verifier))
  url.searchParams.set('code_challenge_method', 'S256')

  return new Response(null, {
    status: 302,
    headers: {
      location: url.toString(),
      'set-cookie': flowCookie(
        await sealFlow(flow, env.MS_SECRET),
        env.MS_PUBLIC_URL,
        FLOW_TTL_MS / 1000,
      ),
    },
  })
})

/** `GET /v1/auth/oidc/callback` — verify everything, then mint a session. */
oidc.get('/callback', async (c) => {
  const env = getEnv()
  const config = oidcConfig()
  if (!config) throw apiError('not_implemented', { message: 'Single sign-on is not configured.' })

  const url = new URL(c.req.url)
  const error = url.searchParams.get('error')
  if (error) {
    throw apiError('not_signed_in', {
      message: `The identity provider refused: ${url.searchParams.get('error_description') ?? error}.`,
    })
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) throw apiError('not_signed_in', { message: 'Incomplete callback.' })

  const cookie = /(?:^|;\s*)ms_oidc=([^;]+)/.exec(c.req.raw.headers.get('cookie') ?? '')?.[1]
  const flow = await openFlow(cookie ? decodeURIComponent(cookie) : undefined, env.MS_SECRET)
  if (!flow) {
    throw apiError('not_signed_in', {
      message: 'That sign-in attempt has expired or did not start here. Try again.',
    })
  }
  // The state check is what stops a third party from feeding us a code they
  // obtained; without it, a link is enough to sign somebody into an account
  // that is not theirs.
  if (!timingSafeEqual(state, flow.state)) {
    throw apiError('not_signed_in', { message: 'The sign-in state did not match. Try again.' })
  }

  const document = await discover(config.issuer)
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${env.MS_PUBLIC_URL}/v1/auth/oidc/callback`,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: flow.verifier,
  })
  const tokenResponse = await fetch(document.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!tokenResponse.ok) {
    throw apiError('not_signed_in', {
      message: `The identity provider would not exchange the code (HTTP ${tokenResponse.status}).`,
    })
  }
  const tokens = (await tokenResponse.json()) as { id_token?: string }
  if (!tokens.id_token) {
    throw apiError('not_signed_in', { message: 'No ID token came back from the provider.' })
  }

  const claims = await verifyIdToken(tokens.id_token, config, document.jwks_uri)
  if (!timingSafeEqual(String(claims.nonce ?? ''), flow.nonce)) {
    throw apiError('not_signed_in', { message: 'The ID token was minted for a different attempt.' })
  }
  if (!claims.email) {
    throw apiError('not_signed_in', {
      message: 'The ID token carries no email address, so there is nobody to sign in.',
    })
  }
  // A provider that says an address is unverified is telling us the holder may
  // not own it. Treat the absence of the claim as unverified too.
  if (claims.email_verified !== true) {
    throw apiError('not_signed_in', {
      message: 'The identity provider has not verified that address.',
    })
  }

  const email = normalizeEmail(claims.email)
  const domain = email.split('@')[1] ?? ''
  if (config.allowedDomains.length > 0 && !config.allowedDomains.includes(domain)) {
    throw apiError('not_signed_in', {
      message: 'That address is not in a domain this instance admits.',
    })
  }

  const sql = tenancyFor(env).db('')
  const { isClaimed } = await import('../bootstrap.ts')
  const claimed = await isClaimed(sql)

  // On an unclaimed instance the first person through any door is the owner —
  // the same rule the passkey and Access paths follow — but `MS_OWNER_EMAIL`
  // still restricts *who*, because that is the whole point of setting it.
  if (!claimed && env.MS_OWNER_EMAIL && normalizeEmail(env.MS_OWNER_EMAIL) !== email) {
    throw apiError('not_signed_in', {
      message: 'This instance is reserved for a different address (MS_OWNER_EMAIL).',
    })
  }

  // Imported here rather than at the top because `auth.ts` mounts this router:
  // a static import would close the cycle and leave one of the two modules
  // half-initialised at the moment the other reads it.
  const { resolveUser } = await import('./auth.ts')
  const user = await resolveUser(sql, email, env.MS_MODE, {
    // Auto-provision is off by default: a claimed instance invites people, it
    // does not enrol whoever can authenticate at the identity provider. With a
    // domain allowlist, enrolling them is the operator's stated intention.
    create: !claimed || (config.autoProvision && config.allowedDomains.length > 0),
  })
  if (!user) {
    throw apiError('not_signed_in', {
      message:
        'That address is not a member of this instance. Ask an owner for an invite, or turn on MS_OIDC_AUTO_PROVISION with a domain allowlist.',
    })
  }

  const token = await issueSession(sql, user.id, user.workspaceId, c.req.raw)
  return new Response(null, {
    status: 302,
    headers: [
      ['location', '/app'],
      ['set-cookie', sessionCookie(token, env.MS_PUBLIC_URL, 30 * 24 * 60 * 60)],
      // The flow cookie has done its job; leaving it set is a replayable
      // verifier sitting in the browser.
      ['set-cookie', flowCookie('', env.MS_PUBLIC_URL, 0)],
    ],
  })
})

export { oidc }

// ---------------------------------------------------------------------------
// ID token verification
// ---------------------------------------------------------------------------

export interface IdTokenClaims {
  iss?: string
  aud?: string | string[]
  exp?: number
  iat?: number
  nonce?: string
  email?: string
  email_verified?: boolean
  name?: string
}

interface Jwk extends JsonWebKey {
  kid?: string
  alg?: string
}

/** JWKS changes when the provider rotates; an hour is the usual advice. */
async function jwks(uri: string): Promise<Jwk[]> {
  const env = getEnv()
  const key = `oidc:jwks:${uri}`
  const cached = await env.CACHE.get(key, 'json')
  if (cached) return (cached as unknown as { keys: Jwk[] }).keys

  const response = await fetch(uri)
  if (!response.ok) {
    throw apiError('not_signed_in', { message: 'The provider’s signing keys are unreachable.' })
  }
  const document = (await response.json()) as { keys: Jwk[] }
  await env.CACHE.put(key, JSON.stringify(document), { expirationTtl: DISCOVERY_TTL_SECONDS })
  return document.keys
}

const ALGORITHMS: Record<
  string,
  { import: EcKeyImportParams | RsaHashedImportParams; verify: AlgorithmIdentifier | EcdsaParams }
> = {
  RS256: {
    import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    verify: { name: 'RSASSA-PKCS1-v1_5' },
  },
  ES256: {
    import: { name: 'ECDSA', namedCurve: 'P-256' },
    verify: { name: 'ECDSA', hash: 'SHA-256' },
  },
}

/**
 * Verifies the ID token: signature first, then every claim that governs whether
 * this token was meant for us.
 *
 * The order matters. Reading claims out of an unverified token and checking
 * them afterwards is the same bug as not checking them at all, because by then
 * the decision has been made on attacker-controlled input.
 */
export async function verifyIdToken(
  token: string,
  config: Pick<OidcConfig, 'issuer' | 'clientId'>,
  jwksUri: string,
): Promise<IdTokenClaims> {
  const [headerPart, payloadPart, signaturePart] = token.split('.')
  if (!headerPart || !payloadPart || !signaturePart) {
    throw apiError('not_signed_in', { message: 'That is not a well-formed ID token.' })
  }

  let header: { alg?: string; kid?: string }
  let claims: IdTokenClaims
  try {
    header = JSON.parse(base64url.decodeText(headerPart))
    claims = JSON.parse(base64url.decodeText(payloadPart))
  } catch {
    throw apiError('not_signed_in', { message: 'That ID token could not be read.' })
  }

  const algorithm = ALGORITHMS[header.alg ?? '']
  if (!algorithm) {
    // `none` lives here too: an unsigned token is the oldest JWT attack there is.
    throw apiError('not_signed_in', {
      message: `Unsupported ID token algorithm ${header.alg ?? 'none'}. RS256 and ES256 are accepted.`,
    })
  }

  const keys = await jwks(jwksUri)
  const candidates = header.kid ? keys.filter((key) => key.kid === header.kid) : keys
  const signature = base64url.decode(signaturePart)
  const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`)

  let valid = false
  for (const jwk of candidates.length > 0 ? candidates : keys) {
    try {
      const key = await crypto.subtle.importKey('jwk', jwk, algorithm.import, false, ['verify'])
      if (
        await crypto.subtle.verify(
          algorithm.verify,
          key,
          signature as unknown as ArrayBuffer,
          signed as unknown as ArrayBuffer,
        )
      ) {
        valid = true
        break
      }
    } catch {
      // A key of the wrong type for this algorithm is not an error; it is one
      // of several keys in the set and the next one may be the right one.
    }
  }
  if (!valid)
    throw apiError('not_signed_in', { message: 'The ID token signature does not verify.' })

  if ((claims.iss ?? '').replace(/\/$/, '') !== config.issuer) {
    throw apiError('not_signed_in', { message: 'The ID token was issued by somebody else.' })
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud ?? '']
  if (!audiences.includes(config.clientId)) {
    throw apiError('not_signed_in', { message: 'The ID token was minted for a different client.' })
  }
  // 60 seconds of leeway for clock skew, and no more: an expired token is
  // expired.
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now() - 60_000) {
    throw apiError('not_signed_in', { message: 'The ID token has expired.' })
  }

  return claims
}
