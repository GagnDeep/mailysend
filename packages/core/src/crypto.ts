/**
 * Crypto primitives, all on WebCrypto so the same code runs on Workers and Node.
 */

const enc = new TextEncoder()

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

export const sha256Hex = async (input: string | ArrayBuffer): Promise<string> =>
  toHex(
    await crypto.subtle.digest('SHA-256', typeof input === 'string' ? enc.encode(input) : input),
  )

const hmacKey = (secret: string) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])

export const hmacHex = async (secret: string, message: string): Promise<string> =>
  toHex(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(message)))

/**
 * Constant-time comparison. Signature verification that leaks timing lets an
 * attacker recover a valid signature byte by byte, so this is not optional even
 * though the difference is invisible in a benchmark.
 */
export const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const base64url = {
  encode(bytes: Uint8Array | string): string {
    const b = typeof bytes === 'string' ? enc.encode(bytes) : bytes
    let bin = ''
    for (const byte of b) bin += String.fromCharCode(byte)
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  decode(s: string): Uint8Array {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  },
  decodeText(s: string): string {
    return new TextDecoder().decode(base64url.decode(s))
  },
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

/**
 * `ms_live_` / `ms_test_` mirrors the prefix scheme every developer already
 * knows from Stripe, and — more usefully — makes the environment visible in a
 * log line or a screenshot, which is how test keys stop reaching production.
 */
export const API_KEY_PREFIX = { live: 'ms_live_', test: 'ms_test_' } as const

export const generateApiKey = (mode: 'live' | 'test' = 'live'): string => {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return API_KEY_PREFIX[mode] + base64url.encode(bytes)
}

/**
 * Keys are stored only as a SHA-256 hash. A database dump therefore does not
 * yield working credentials — which is the entire reason a key is shown once.
 */
export const hashApiKey = (token: string): Promise<string> => sha256Hex(token)

export const apiKeyMode = (token: string): 'live' | 'test' | null =>
  token.startsWith(API_KEY_PREFIX.live)
    ? 'live'
    : token.startsWith(API_KEY_PREFIX.test)
      ? 'test'
      : null

export const apiKeyPreview = (token: string): string => `${token.slice(0, 12)}…${token.slice(-4)}`

// ---------------------------------------------------------------------------
// Tracking tokens
// ---------------------------------------------------------------------------

export interface TrackingClaims {
  emailId: string
  workspaceId: string
  /** Absent for opens. */
  linkId?: string
  /** Index of the recipient within the message, so per-recipient opens are distinguishable. */
  r?: number
}

/**
 * A self-validating tracking token.
 *
 * The tracking Worker has no database binding at all — that is what keeps its
 * bundle at ~15 KB and its cold start invisible on the pixel path. It can only
 * do that if a token proves its own authenticity, so the payload is signed and
 * a forged pixel is rejected with zero lookups.
 */
export const signTrackingToken = async (
  secret: string,
  claims: TrackingClaims,
): Promise<string> => {
  const payload = base64url.encode(JSON.stringify(claims))
  const sig = (await hmacHex(secret, payload)).slice(0, 32)
  return `${payload}.${sig}`
}

export const verifyTrackingToken = async (
  secret: string,
  token: string,
): Promise<TrackingClaims | null> => {
  const dot = token.lastIndexOf('.')
  if (dot < 1) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = (await hmacHex(secret, payload)).slice(0, 32)
  if (!timingSafeEqual(sig, expected)) return null
  try {
    return JSON.parse(base64url.decodeText(payload)) as TrackingClaims
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Webhook signatures
// ---------------------------------------------------------------------------

/**
 * `MailySend-Signature: t=<unix>,v1=<hex>` over `${t}.${body}`.
 * The timestamp is inside the signed material, so a captured delivery cannot be
 * replayed outside the tolerance window even though the signature stays valid.
 */
export const signWebhook = async (
  secret: string,
  body: string,
  timestamp = Math.floor(Date.now() / 1000),
) => {
  const v1 = await hmacHex(secret, `${timestamp}.${body}`)
  return { header: `t=${timestamp},v1=${v1}`, timestamp, v1 }
}

export const verifyWebhook = async (
  secret: string,
  header: string,
  body: string,
  toleranceSeconds = 300,
): Promise<boolean> => {
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.split('=').map((s) => s.trim()) as [string, string]),
  )
  const t = Number(parts.t)
  if (!Number.isFinite(t)) return false
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSeconds) return false
  const expected = await hmacHex(secret, `${t}.${body}`)
  return timingSafeEqual(parts.v1 ?? '', expected)
}

// ---------------------------------------------------------------------------
// Inbound reply tokens
// ---------------------------------------------------------------------------

/**
 * Encoded into the reply-to address as `reply+<token>@inbound.<domain>`, giving
 * threading its highest-confidence signal — mail clients mangle References and
 * rewrite subjects, but they preserve the address they were told to reply to.
 *
 * An invalid token never drops mail: threading falls through to In-Reply-To,
 * then to subject-plus-participants, then to a new thread.
 */
export const signReplyToken = async (secret: string, threadId: string, workspaceId: string) => {
  const payload = base64url.encode(`${workspaceId}|${threadId}`)
  const sig = (await hmacHex(secret, payload)).slice(0, 20)
  return `${payload}~${sig}`
}

export const verifyReplyToken = async (
  secret: string,
  token: string,
): Promise<{ workspaceId: string; threadId: string } | null> => {
  const [payload, sig] = token.split('~')
  if (!payload || !sig) return null
  if (!timingSafeEqual(sig, (await hmacHex(secret, payload)).slice(0, 20))) return null
  const [workspaceId, threadId] = base64url.decodeText(payload).split('|')
  return workspaceId && threadId ? { workspaceId, threadId } : null
}

// ---------------------------------------------------------------------------
// Deterministic hashing for routing and A/B assignment
// ---------------------------------------------------------------------------

/**
 * FNV-1a. Not cryptographic and not meant to be — it is used for provider
 * selection and A/B bucketing, where the requirement is that the same input
 * always lands in the same bucket, on any runtime, forever.
 *
 * Provider selection in particular *depends* on determinism: a retry must reach
 * the same provider as the original attempt, or a timeout could deliver twice
 * across two different transports.
 */
export const stableHash = (input: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Picks a bucket in [0, buckets) deterministically. */
export const stableBucket = (input: string, buckets: number): number => stableHash(input) % buckets
