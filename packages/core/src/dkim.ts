/**
 * DKIM signing, RFC 6376.
 *
 * This existed as a shape and never as a signature: `OutboundMessage` has
 * carried `dkim { domain, selector, privateKey }` since the beginning, every
 * adapter has published a `v=DKIM1` record holding our public key, and not one
 * line of code has ever signed anything. A published key with no signature on
 * the wire is worse than no key at all — a receiver that checks finds a record
 * promising a signature and no signature to check, which is precisely the shape
 * of a spoof.
 *
 * relaxed/relaxed canonicalisation, `rsa-sha256`, over WebCrypto so the same
 * code runs on Workers and on Node.
 */

const CRLF = '\r\n'

/** The headers worth signing, in the order they are signed. */
const DEFAULT_HEADERS = [
  'from',
  'to',
  'cc',
  'subject',
  'date',
  'message-id',
  'mime-version',
  'content-type',
  'content-transfer-encoding',
  'reply-to',
  'list-unsubscribe',
  'list-unsubscribe-post',
]

export interface DkimOptions {
  domain: string
  selector: string
  /** PKCS#8 PEM, as `generateDkimKeypair` produces. */
  privateKey: string
  /** Overrides the signed header list. Order is significant. */
  headers?: string[]
  /** Fixed timestamp, for reproducible tests. */
  now?: Date
  /** Seconds until the signature expires. Omitted from the tag when absent. */
  expiresIn?: number
}

/**
 * Splits a message into its header block and its body, on the first blank line.
 *
 * A message with no blank line at all has no body, which is legal: `\r\n\r\n`
 * is the separator, and its absence means everything is headers.
 */
export function splitMessage(message: string): { headers: string; body: string } {
  const normalized = message.replace(/\r?\n/g, CRLF)
  const index = normalized.indexOf(CRLF + CRLF)
  if (index === -1) return { headers: normalized, body: '' }
  return { headers: normalized.slice(0, index), body: normalized.slice(index + 4) }
}

/**
 * Unfolds a header block into `[name, value]` pairs, preserving order and
 * duplicates. Both matter: `Received` appears many times, and DKIM signs the
 * *last* instance of a header first when a name is listed more than once.
 */
export function parseHeaders(block: string): [string, string][] {
  const out: [string, string][] = []
  for (const line of block.split(CRLF)) {
    if (/^[ \t]/.test(line) && out.length > 0) {
      const last = out[out.length - 1] as [string, string]
      last[1] = `${last[1]}${CRLF}${line}`
      continue
    }
    const colon = line.indexOf(':')
    if (colon === -1) continue
    out.push([line.slice(0, colon), line.slice(colon + 1)])
  }
  return out
}

/**
 * Relaxed header canonicalisation (RFC 6376 §3.4.2).
 *
 * Lower-case the name, unfold the value, collapse runs of whitespace to one
 * space, strip leading and trailing whitespace, and rejoin with a single colon.
 */
export function canonicalizeHeader(name: string, value: string): string {
  const unfolded = value.replace(/\r\n[ \t]+/g, ' ')
  const collapsed = unfolded.replace(/[ \t]+/g, ' ').trim()
  return `${name.toLowerCase().trim()}:${collapsed}`
}

/**
 * Relaxed body canonicalisation (RFC 6376 §3.4.4).
 *
 * Whitespace at the end of each line goes, runs of whitespace within a line
 * collapse to one space, and trailing empty lines are removed — but a non-empty
 * body always ends with exactly one CRLF, and an empty body canonicalises to
 * the empty string.
 */
export function canonicalizeBody(body: string): string {
  const normalized = body.replace(/\r?\n/g, CRLF)
  const lines = normalized
    .split(CRLF)
    .map((line) => line.replace(/[ \t]+/g, ' ').replace(/[ \t]+$/, ''))
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) return ''
  return `${lines.join(CRLF)}${CRLF}`
}

const base64 = (bytes: ArrayBuffer | Uint8Array): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** Strips the PEM armour and decodes the DER inside it. */
export function pemToBytes(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function importSigningKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(pem) as unknown as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

/**
 * Signs a complete RFC 5322 message and returns it with the `DKIM-Signature`
 * header prepended.
 *
 * Prepended rather than appended because a signature added at the top is the
 * one an MTA that adds `Received` lines above it will not disturb, and because
 * the header this function itself adds must be the first thing a verifier finds.
 */
export async function signMessage(message: string, options: DkimOptions): Promise<string> {
  const { headers: headerBlock, body } = splitMessage(message)
  const parsed = parseHeaders(headerBlock)

  const present = new Set(parsed.map(([name]) => name.toLowerCase()))
  // A header that is not in the message cannot be signed, and listing it in `h=`
  // anyway is how a signature ends up covering a header an attacker can then
  // add. Only what is actually there.
  const signedNames = (options.headers ?? DEFAULT_HEADERS).filter((name) => present.has(name))

  const bodyHash = base64(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalizeBody(body))),
  )

  const timestamp = Math.floor((options.now?.getTime() ?? Date.now()) / 1000)
  const tags = [
    'v=1',
    'a=rsa-sha256',
    'c=relaxed/relaxed',
    `d=${options.domain}`,
    `s=${options.selector}`,
    `t=${timestamp}`,
    ...(options.expiresIn ? [`x=${timestamp + options.expiresIn}`] : []),
    `bh=${bodyHash}`,
    `h=${signedNames.join(':')}`,
    'b=',
  ]
  const signatureHeader = `DKIM-Signature: ${tags.join('; ')}`

  // The signature covers the signed headers followed by the signature header
  // itself with an empty `b=` and, uniquely, no trailing CRLF.
  const canonicalHeaders = signedNames.map((name) => {
    const found = [...parsed].reverse().find(([key]) => key.toLowerCase() === name)
    return canonicalizeHeader(name, found?.[1] ?? '')
  })
  const toSign = [
    ...canonicalHeaders,
    canonicalizeHeader('dkim-signature', ` ${tags.join('; ')}`),
  ].join(CRLF)

  const key = await importSigningKey(options.privateKey)
  const signature = base64(
    await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(toSign) as unknown as ArrayBuffer,
    ),
  )

  // Folded at 76 columns like any other long header: an unfolded 400-character
  // signature is legal and is also the thing some MTAs truncate.
  const folded = `${signatureHeader}${(signature.match(/.{1,72}/g) ?? []).join(`${CRLF} `)}`
  return `${folded}${CRLF}${headerBlock}${CRLF}${CRLF}${body}`
}

/**
 * Verifies a signature against a public key. Used by the tests and by the
 * placement tooling; receivers do their own verification, not ours.
 */
export async function verifySignature(
  message: string,
  publicKeyPem: string,
): Promise<{ valid: boolean; reason?: string }> {
  const { headers: headerBlock, body } = splitMessage(message)
  const parsed = parseHeaders(headerBlock)
  const signature = parsed.find(([name]) => name.toLowerCase() === 'dkim-signature')
  if (!signature) return { valid: false, reason: 'no DKIM-Signature header' }

  const raw = signature[1].replace(/\r\n[ \t]*/g, '')
  const tags = new Map<string, string>()
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    tags.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim())
  }

  const bodyHash = base64(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalizeBody(body))),
  )
  if (bodyHash !== tags.get('bh')) return { valid: false, reason: 'body hash mismatch' }

  const signedNames = (tags.get('h') ?? '').split(':').filter(Boolean)
  const canonicalHeaders = signedNames.map((name) => {
    const found = [...parsed].reverse().find(([key]) => key.toLowerCase() === name.toLowerCase())
    return canonicalizeHeader(name, found?.[1] ?? '')
  })
  const withoutB = raw.replace(/b=[^;]*/, 'b=')
  const toVerify = [...canonicalHeaders, canonicalizeHeader('dkim-signature', withoutB)].join(CRLF)

  const key = await crypto.subtle.importKey(
    'spki',
    pemToBytes(publicKeyPem) as unknown as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    Uint8Array.from(atob(tags.get('b') ?? ''), (c) => c.charCodeAt(0)) as unknown as ArrayBuffer,
    new TextEncoder().encode(toVerify) as unknown as ArrayBuffer,
  )
  return valid ? { valid: true } : { valid: false, reason: 'signature does not verify' }
}
