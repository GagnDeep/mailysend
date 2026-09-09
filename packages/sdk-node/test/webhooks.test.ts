import { describe, expect, it } from 'vitest'
import { verifySignature } from '../src/index.ts'
import { harness, json } from './helpers.ts'

const SECRET = 'whsec_test_secret'
const PAYLOAD = JSON.stringify({
  type: 'email.delivered',
  created_at: '2026-01-01T00:00:00Z',
  data: { id: 'em_1' },
})

/** Signs exactly as `signWebhook` in @mailysend/core does, so the test proves interop. */
const sign = async (payload: string, secret: string, timestamp: number): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  )
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `t=${timestamp},v1=${hex}`
}

describe('verifySignature', () => {
  it('accepts a fresh, correctly signed payload', async () => {
    const now = Date.now()
    const header = await sign(PAYLOAD, SECRET, Math.floor(now / 1000))

    await expect(verifySignature(PAYLOAD, header, SECRET, { now })).resolves.toBe(true)
  })

  it('rejects a tampered payload', async () => {
    const now = Date.now()
    const header = await sign(PAYLOAD, SECRET, Math.floor(now / 1000))
    const tampered = PAYLOAD.replace('em_1', 'em_2')

    await expect(verifySignature(tampered, header, SECRET, { now })).resolves.toBe(false)
  })

  it('rejects the wrong secret', async () => {
    const now = Date.now()
    const header = await sign(PAYLOAD, SECRET, Math.floor(now / 1000))

    await expect(verifySignature(PAYLOAD, header, 'whsec_other', { now })).resolves.toBe(false)
  })

  it('rejects a signature outside the tolerance window even though it is valid', async () => {
    const signedAt = Math.floor(Date.now() / 1000) - 3600
    const header = await sign(PAYLOAD, SECRET, signedAt)

    await expect(verifySignature(PAYLOAD, header, SECRET)).resolves.toBe(false)
    // Widening the window is the only thing that changes, which is what proves
    // the rejection was the clock and not the mac.
    await expect(
      verifySignature(PAYLOAD, header, SECRET, { toleranceSeconds: 7200 }),
    ).resolves.toBe(true)
  })

  it('rejects a timestamp too far in the future', async () => {
    const signedAt = Math.floor(Date.now() / 1000) + 3600
    const header = await sign(PAYLOAD, SECRET, signedAt)

    await expect(verifySignature(PAYLOAD, header, SECRET)).resolves.toBe(false)
  })

  it('rejects a malformed header rather than throwing', async () => {
    for (const header of ['', 'garbage', 't=abc,v1=deadbeef', 'v1=deadbeef', 't=123']) {
      await expect(verifySignature(PAYLOAD, header, SECRET)).resolves.toBe(false)
    }
  })

  it('rejects a signature of the right shape but the wrong length', async () => {
    const t = Math.floor(Date.now() / 1000)
    await expect(verifySignature(PAYLOAD, `t=${t},v1=ff`, SECRET)).resolves.toBe(false)
  })

  it('tolerates whitespace around the header parts', async () => {
    const now = Date.now()
    const header = (await sign(PAYLOAD, SECRET, Math.floor(now / 1000))).replace(',', ', ')

    await expect(verifySignature(PAYLOAD, header, SECRET, { now })).resolves.toBe(true)
  })

  it('is reachable from the client for discoverability', async () => {
    const h = harness([json({ object: 'list', data: [], has_more: false })])
    const now = Date.now()
    const header = await sign(PAYLOAD, SECRET, Math.floor(now / 1000))

    await expect(h.client.webhooks.verify(PAYLOAD, header, SECRET, { now })).resolves.toBe(true)
    expect(h.calls()).toBe(0)
  })
})
