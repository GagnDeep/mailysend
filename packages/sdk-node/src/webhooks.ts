import type { HttpClient, RequestOptions } from './http.ts'
import { asQuery } from './http.ts'
import type * as T from './types.ts'

/** The default drift allowance, matching `SIGNATURE_TOLERANCE_SECONDS` on the server. */
export const SIGNATURE_TOLERANCE_SECONDS = 300

export interface VerifyOptions {
  toleranceSeconds?: number
  /** Injectable clock, so a test can prove the tolerance window actually closes. */
  now?: number
}

const encoder = new TextEncoder()

/**
 * Constant-time comparison. A verifier that leaks timing lets an attacker
 * recover a valid signature byte by byte, which is not a theoretical attack
 * against an endpoint they can call as often as they like.
 */
const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const hmacHex = async (secret: string, message: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Verifies `MailySend-Signature: t=<unix>,v1=<hex>` over `${t}.${payload}`.
 *
 * `payload` must be the raw request body, byte for byte. Re-serialising a
 * parsed object reorders keys and normalises whitespace, and the signature is
 * over bytes — this is the single most common reason a correct secret still
 * fails to verify.
 *
 * The timestamp is inside the signed material, so a captured delivery stays
 * cryptographically valid forever; the tolerance window is what stops it being
 * replayable.
 */
export const verifySignature = async (
  payload: string,
  signature: string,
  secret: string,
  options: VerifyOptions = {},
): Promise<boolean> => {
  const parts = new Map<string, string>()
  for (const part of signature.split(',')) {
    const at = part.indexOf('=')
    if (at === -1) continue
    parts.set(part.slice(0, at).trim(), part.slice(at + 1).trim())
  }

  const timestamp = Number(parts.get('t'))
  const provided = parts.get('v1')
  if (!Number.isFinite(timestamp) || !provided) return false

  const tolerance = options.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS
  const now = Math.floor((options.now ?? Date.now()) / 1000)
  if (Math.abs(now - timestamp) > tolerance) return false

  return timingSafeEqual(provided, await hmacHex(secret, `${timestamp}.${payload}`))
}

export class Webhooks {
  #http: HttpClient

  constructor(http: HttpClient) {
    this.#http = http
  }

  /** The secret is in the create response only. It is never retrievable again. */
  create(body: T.CreateWebhookRequest, options?: RequestOptions): Promise<T.Webhook> {
    return this.#http.request({ method: 'POST', path: '/v1/webhooks', body, options })
  }

  list(params?: T.PaginationParams, options?: RequestOptions): Promise<T.ListResponse<T.Webhook>> {
    return this.#http.request({
      method: 'GET',
      path: '/v1/webhooks',
      query: asQuery(params),
      options,
    })
  }

  get(id: string, options?: RequestOptions): Promise<T.Webhook> {
    return this.#http.request({
      method: 'GET',
      path: `/v1/webhooks/${encodeURIComponent(id)}`,
      options,
    })
  }

  update(id: string, body: T.UpdateWebhookRequest, options?: RequestOptions): Promise<T.Webhook> {
    return this.#http.request({
      method: 'PATCH',
      path: `/v1/webhooks/${encodeURIComponent(id)}`,
      body,
      options,
    })
  }

  remove(id: string, options?: RequestOptions): Promise<T.DeletedResponse<'webhook'>> {
    return this.#http.request({
      method: 'DELETE',
      path: `/v1/webhooks/${encodeURIComponent(id)}`,
      options,
    })
  }

  deliveries(
    id: string,
    params?: T.PaginationParams & { status?: string },
    options?: RequestOptions,
  ): Promise<T.ListResponse<T.WebhookDelivery>> {
    return this.#http.request({
      method: 'GET',
      path: `/v1/webhooks/${encodeURIComponent(id)}/deliveries`,
      query: asQuery(params),
      options,
    })
  }

  replay(id: string, deliveryId: string, options?: RequestOptions): Promise<T.WebhookDelivery> {
    return this.#http.request({
      method: 'POST',
      path: `/v1/webhooks/${encodeURIComponent(id)}/deliveries/${encodeURIComponent(deliveryId)}/replay`,
      options,
    })
  }

  test(id: string, options?: RequestOptions): Promise<T.WebhookDelivery> {
    return this.#http.request({
      method: 'POST',
      path: `/v1/webhooks/${encodeURIComponent(id)}/test`,
      options,
    })
  }

  /**
   * Verifies a delivery. Lives on the client for discoverability even though it
   * makes no request — this is the method people go looking for, and they look
   * for it next to the endpoints that created the secret.
   */
  verify(
    payload: string,
    signature: string,
    secret: string,
    options?: VerifyOptions,
  ): Promise<boolean> {
    return verifySignature(payload, signature, secret, options)
  }
}
