/**
 * AWS SigV4, on WebCrypto.
 *
 * `@aws-sdk/client-sesv2` would do this for us, but it pulls roughly a megabyte
 * of middleware into a Worker bundle to sign one request shape. SigV4 is about
 * eighty lines when you only need `POST` with a JSON body, and it keeps the
 * cold start of the send path — the thing the whole product is arguing about —
 * measured in single-digit milliseconds.
 */

const enc = new TextEncoder()

const hex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

const sha256 = async (data: string | Uint8Array): Promise<string> =>
  hex(
    await crypto.subtle.digest(
      'SHA-256',
      typeof data === 'string' ? enc.encode(data) : (data as BufferSource),
    ),
  )

const hmac = async (key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data))
}

export interface SigV4Options {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  region: string
  service: string
}

export interface SignedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: string
}

export async function signRequest(
  { url, method, headers, body }: SignedRequest,
  options: SigV4Options,
): Promise<Record<string, string>> {
  const parsed = new URL(url)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)

  const allHeaders: Record<string, string> = {
    ...headers,
    host: parsed.host,
    'x-amz-date': amzDate,
    ...(options.sessionToken ? { 'x-amz-security-token': options.sessionToken } : {}),
  }

  // Header names lowercased and sorted; values trimmed and internal runs of
  // whitespace collapsed. Getting any of this wrong yields a 403 with no hint.
  const canonicalHeaderNames = Object.keys(allHeaders)
    .map((h) => h.toLowerCase())
    .sort()
  const canonicalHeaders = canonicalHeaderNames
    .map((name) => {
      const key = Object.keys(allHeaders).find((k) => k.toLowerCase() === name)!
      return `${name}:${String(allHeaders[key]).trim().replace(/\s+/g, ' ')}\n`
    })
    .join('')
  const signedHeaders = canonicalHeaderNames.join(';')

  const payloadHash = await sha256(body)
  const canonicalQuery = [...parsed.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const canonicalRequest = [
    method,
    parsed.pathname || '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${options.region}/${options.service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonicalRequest)].join(
    '\n',
  )

  let key: ArrayBuffer | Uint8Array = enc.encode(`AWS4${options.secretAccessKey}`)
  for (const part of [dateStamp, options.region, options.service, 'aws4_request']) {
    key = await hmac(key, part)
  }
  const signature = hex(await hmac(key, stringToSign))

  return {
    ...allHeaders,
    'x-amz-content-sha256': payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}
