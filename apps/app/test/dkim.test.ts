import {
  canonicalizeBody,
  canonicalizeHeader,
  parseHeaders,
  signMessage,
  splitMessage,
  verifySignature,
} from '@mailysend/core'
import { buildSignedMime } from '@mailysend/providers'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * DKIM.
 *
 * The canonicalisation cases come from RFC 6376 §3.4.5, which is the one place
 * the answer is not a matter of opinion. The signing cases are round trips
 * against a freshly generated key, because a signature that verifies against
 * its own public key is exactly what a receiver will be doing.
 */

const CRLF = '\r\n'

let keys: { privateKey: string; publicKey: string }

const toBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const [privateKey, publicKey] = await Promise.all([
    crypto.subtle.exportKey('pkcs8', pair.privateKey),
    crypto.subtle.exportKey('spki', pair.publicKey),
  ])
  keys = { privateKey: toBase64(privateKey), publicKey: toBase64(publicKey) }
}, 30_000)

const message = [
  'From: Ana <ana@example.com>',
  'To: Bo <bo@example.net>',
  'Subject: A  subject   with    spaces',
  'Date: Thu, 01 Jan 2026 00:00:00 +0000',
  'Message-ID: <em_1@example.com>',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=UTF-8',
  '',
  'Hello there.',
  '',
].join(CRLF)

describe('canonicalisation — RFC 6376 §3.4.5', () => {
  // The RFC's worked example: the relaxed form of
  //   A: X\r\nB : Y\t\r\n\tZ  \r\n
  // is
  //   a:X\r\nb:Y Z\r\n
  it('relaxes a header name, its whitespace and its folding', () => {
    expect(canonicalizeHeader('A', ' X')).toBe('a:X')
    expect(canonicalizeHeader('B ', ` Y\t${CRLF}\tZ  `)).toBe('b:Y Z')
  })

  // And the relaxed body of
  //   " C \r\nD \t E\r\n\r\n\r\n"
  // is
  //   " C\r\nD E\r\n"
  it('relaxes the body and drops trailing empty lines', () => {
    expect(canonicalizeBody(` C ${CRLF}D \t E${CRLF}${CRLF}${CRLF}`)).toBe(` C${CRLF}D E${CRLF}`)
  })

  it('canonicalises an empty body to nothing at all', () => {
    expect(canonicalizeBody('')).toBe('')
    expect(canonicalizeBody(CRLF + CRLF)).toBe('')
  })

  it('always ends a non-empty body with exactly one CRLF', () => {
    expect(canonicalizeBody('one line')).toBe(`one line${CRLF}`)
    expect(canonicalizeBody(`one line${CRLF}${CRLF}${CRLF}`)).toBe(`one line${CRLF}`)
  })
})

describe('splitMessage and parseHeaders', () => {
  it('splits on the first blank line', () => {
    const { headers, body } = splitMessage(message)
    expect(headers).toContain('From: Ana')
    expect(body).toBe(`Hello there.${CRLF}`)
  })

  it('keeps duplicate headers and their order', () => {
    const parsed = parseHeaders(['Received: from a', 'Received: from b', 'Subject: x'].join(CRLF))
    expect(parsed.map(([name]) => name)).toEqual(['Received', 'Received', 'Subject'])
  })

  it('unfolds a continued header into one value', () => {
    const parsed = parseHeaders(`Subject: one${CRLF} two`)
    expect(canonicalizeHeader(parsed[0]?.[0] as string, parsed[0]?.[1] as string)).toBe(
      'subject:one two',
    )
  })
})

describe('signMessage', () => {
  it('produces a signature that verifies against its own public key', async () => {
    const signed = await signMessage(message, {
      domain: 'example.com',
      selector: 'ms1',
      privateKey: keys.privateKey,
    })
    expect(signed).toMatch(/^DKIM-Signature: v=1; a=rsa-sha256; c=relaxed\/relaxed;/)
    await expect(verifySignature(signed, keys.publicKey)).resolves.toEqual({ valid: true })
  })

  it('names the domain and selector the DNS record is published under', async () => {
    const signed = await signMessage(message, {
      domain: 'example.com',
      selector: 'ms1',
      privateKey: keys.privateKey,
    })
    expect(signed).toContain('d=example.com')
    expect(signed).toContain('s=ms1')
  })

  it('signs only headers that are present', async () => {
    const signed = await signMessage(message, {
      domain: 'example.com',
      selector: 'ms1',
      privateKey: keys.privateKey,
    })
    const h = /(?:^|; )h=([^;]+);/.exec(signed)?.[1] ?? ''
    expect(h).toContain('from')
    expect(h).toContain('subject')
    // There is no Cc in this message, so signing one would let anybody add it.
    expect(h.split(':')).not.toContain('cc')
  })

  it('fails verification when the body is altered after signing', async () => {
    const signed = await signMessage(message, {
      domain: 'example.com',
      selector: 'ms1',
      privateKey: keys.privateKey,
    })
    const tampered = signed.replace('Hello there.', 'Send money instead.')
    await expect(verifySignature(tampered, keys.publicKey)).resolves.toMatchObject({
      valid: false,
      reason: 'body hash mismatch',
    })
  })

  it('fails verification when a signed header is altered after signing', async () => {
    const signed = await signMessage(message, {
      domain: 'example.com',
      selector: 'ms1',
      privateKey: keys.privateKey,
    })
    const tampered = signed.replace('Subject: A  subject', 'Subject: Your invoice')
    await expect(verifySignature(tampered, keys.publicKey)).resolves.toMatchObject({ valid: false })
  })

  it('survives the whitespace mangling relaxed canonicalisation exists to absorb', async () => {
    const signed = await signMessage(message, {
      domain: 'example.com',
      selector: 'ms1',
      privateKey: keys.privateKey,
    })
    // A relay collapsing runs of spaces in a header is exactly what relaxed
    // canonicalisation is for, and must not break the signature.
    const relayed = signed.replace('A  subject   with    spaces', 'A subject with spaces')
    await expect(verifySignature(relayed, keys.publicKey)).resolves.toEqual({ valid: true })
  })
})

describe('buildSignedMime', () => {
  const outbound = {
    emailId: 'em_test1',
    from: { address: 'ana@example.com', name: 'Ana', domain: 'example.com' },
    to: [{ address: 'bo@example.net', domain: 'example.net' }],
    subject: 'Signed on the way out',
    text: 'Body.',
    html: '<p>Body.</p>',
  }

  it('signs a built message when the domain has a key', async () => {
    const raw = await buildSignedMime({
      ...outbound,
      dkim: { domain: 'example.com', selector: 'ms1', privateKey: keys.privateKey },
    } as never)
    expect(raw).toContain('DKIM-Signature:')
    await expect(verifySignature(raw, keys.publicKey)).resolves.toEqual({ valid: true })
  })

  it('sends unsigned rather than not at all when there is no key', async () => {
    const raw = await buildSignedMime(outbound as never)
    expect(raw).not.toContain('DKIM-Signature:')
    expect(raw).toContain('Subject: Signed on the way out')
  })

  it('sends unsigned rather than failing when the key is unusable', async () => {
    const raw = await buildSignedMime({
      ...outbound,
      dkim: { domain: 'example.com', selector: 'ms1', privateKey: 'not-a-key' },
    } as never)
    expect(raw).not.toContain('DKIM-Signature:')
    expect(raw).toContain('Subject: Signed on the way out')
  })
})
