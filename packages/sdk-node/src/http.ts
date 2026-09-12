import { MailySendConnectionError, MailySendError } from './error.ts'
import type { ErrorBody } from './types.ts'

export const VERSION = '0.1.0'

export interface ClientOptions {
  /** `ms_live_…` or `ms_test_…`. Falls back to `MAILYSEND_API_KEY` in the environment. */
  apiKey?: string
  /**
   * The origin you deployed MailySend to. Required — there is no hosted
   * MailySend to default to. Falls back to `MAILYSEND_BASE_URL` in the
   * environment. Trailing slashes are fine.
   */
  baseUrl?: string
  /** Attempts after the first. 0 disables retrying entirely. */
  maxRetries?: number
  /** Per-attempt timeout. The retry budget is therefore `(timeout + backoff) * attempts`. */
  timeoutMs?: number
  /** First-retry delay before jitter; each further attempt doubles it. */
  baseBackoffMs?: number
  headers?: Record<string, string>
  /** Swap in a custom fetch — a proxy agent, a test double, a tracing wrapper. */
  fetch?: typeof globalThis.fetch
}

export interface RequestOptions {
  /**
   * Sent as `Idempotency-Key`, replacing the one this SDK would generate.
   * `null` suppresses the header — and with it, retrying the POST at all.
   */
  idempotencyKey?: string | null
  signal?: AbortSignal
  headers?: Record<string, string>
  maxRetries?: number
}

export type Query = Record<string, string | number | boolean | undefined | null>

/** Drops absent params so `?limit=20` never becomes `?limit=20&after=undefined`. */
export const asQuery = (params: object | undefined): Query | undefined => {
  if (!params) return undefined
  const out: Query = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    out[key] = value as string | number | boolean
  }
  return out
}

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_TIMEOUT_MS = 60_000
const BASE_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 8_000
/**
 * A `Retry-After` longer than this is treated as advice we cannot take. An hour
 * of quota exhaustion is real, but silently parking a caller's request for an
 * hour is worse than handing them the 429 and letting them decide.
 */
const MAX_ADVISED_DELAY_MS = 60_000

/**
 * `process` is read through `globalThis` and guarded because this file also
 * runs on Workers and Deno, where touching a bare `process` identifier is a
 * ReferenceError rather than `undefined`.
 */
const readEnv = (name: string): string | undefined => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env
  return env?.[name]
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * `Retry-After` arrives as either delta-seconds or an HTTP-date; both forms are
 * in the spec and real gateways emit both. A server that tells us when to come
 * back always wins over our own backoff curve — that is the whole point of it
 * telling us.
 */
const parseRetryAfter = (header: string | null): number | null => {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const at = Date.parse(header)
  if (Number.isNaN(at)) return null
  return Math.max(0, at - Date.now())
}

/**
 * Exponential backoff with full jitter. Jitter is not decoration: without it a
 * fleet that all got rate-limited by the same spike retries in lockstep and
 * reproduces the spike exactly one backoff later.
 */
const backoffMs = (attempt: number, base: number): number =>
  Math.random() * Math.min(MAX_BACKOFF_MS, base * 2 ** attempt)

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

const buildQuery = (query: Query | undefined): string => {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    params.set(key, String(value))
  }
  const serialized = params.toString()
  return serialized ? `?${serialized}` : ''
}

export interface HttpCall {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  query?: Query
  body?: unknown
  options?: RequestOptions
}

/**
 * The transport.
 *
 * Every resource method funnels through `request()`, which owns exactly three
 * concerns: auth, serialisation, and the retry policy. Resources stay as thin
 * as a URL and a type parameter, so adding an endpoint cannot accidentally
 * introduce a second retry rule.
 */
export class HttpClient {
  readonly baseUrl: string
  #apiKey: string
  #maxRetries: number
  #timeoutMs: number
  #baseBackoffMs: number
  #headers: Record<string, string>
  #fetch: typeof globalThis.fetch | undefined

  constructor(options: ClientOptions = {}) {
    const apiKey = options.apiKey ?? readEnv('MAILYSEND_API_KEY') ?? readEnv('RESEND_API_KEY') ?? ''
    if (!apiKey) {
      throw new Error(
        'Missing API key. Pass one to the client or set MAILYSEND_API_KEY in the environment.',
      )
    }
    this.#apiKey = apiKey
    // There is no default host. MailySend is deployed into the caller's own
    // Cloudflare account, so there is no address this client could guess that
    // would be right for anyone — and the one it used to guess,
    // `https://api.mailysend.com`, does not resolve, which turned a
    // configuration mistake into a DNS error a long way from its cause. Same
    // treatment as the missing API key above: say what is missing, up front.
    const baseUrl = options.baseUrl ?? readEnv('MAILYSEND_BASE_URL')
    if (!baseUrl) {
      throw new Error(
        'Missing base URL. Pass one to the client or set MAILYSEND_BASE_URL in the environment — ' +
          'it is the origin you deployed MailySend to, e.g. https://mail.example.com.',
      )
    }
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.#maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#baseBackoffMs = options.baseBackoffMs ?? BASE_BACKOFF_MS
    this.#headers = options.headers ?? {}
    // Resolved per call rather than captured, so a runtime that installs its
    // fetch after module load — and a test that swaps in a double — both work.
    this.#fetch = options.fetch
  }

  async request<T>(call: HttpCall): Promise<T> {
    const { method, path, query, body, options = {} } = call
    const url = `${this.baseUrl}${path}${buildQuery(query)}`
    const hasBody = body !== undefined && method !== 'GET'

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#apiKey}`,
      accept: 'application/json',
      'user-agent': `mailysend-node/${VERSION}`,
      ...this.#headers,
      ...options.headers,
    }
    if (hasBody) headers['content-type'] = 'application/json'

    /**
     * The key is minted once per *call*, not per attempt. That is the entire
     * safety property: attempt two carries the same key as attempt one, so a
     * send that timed out after the server accepted it is deduplicated instead
     * of delivered twice. A key generated inside the retry loop would make
     * retrying strictly more dangerous than not retrying.
     */
    if (method === 'POST' && options.idempotencyKey !== null) {
      headers['idempotency-key'] = options.idempotencyKey ?? crypto.randomUUID()
    }

    const payload = hasBody ? JSON.stringify(body) : undefined
    const maxRetries = options.maxRetries ?? this.#maxRetries
    // A POST is only ever safe to replay because of the key above. A caller who
    // passes `idempotencyKey: null` has taken that guarantee away, so the
    // request is sent exactly once no matter what the server answers.
    const retryable = method !== 'POST' || headers['idempotency-key'] !== undefined
    const fetchImpl = this.#fetch ?? globalThis.fetch

    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(this.#timeoutMs)
      const signal = options.signal
        ? AbortSignal.any([options.signal, timeout])
        : (timeout as AbortSignal)

      let response: Response
      try {
        response = await fetchImpl(url, {
          method,
          headers,
          ...(payload === undefined ? {} : { body: payload }),
          signal,
        })
      } catch (cause) {
        // A caller-initiated abort is a decision, not a failure to retry around.
        // The reason is rethrown rather than the transport's own error, which
        // is what a native fetch does and what a caller's catch block expects.
        if (options.signal?.aborted) throw options.signal.reason ?? cause
        const failure = new MailySendConnectionError(
          `Could not reach ${this.baseUrl}: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        )
        if (!retryable || attempt >= maxRetries) throw failure
        await sleep(backoffMs(attempt, this.#baseBackoffMs), options.signal)
        continue
      }

      if (response.ok) return await this.#decode<T>(response)

      const error = await this.#toError(response)
      const shouldRetry =
        retryable &&
        attempt < maxRetries &&
        (response.status === 429 || response.status === 408 || response.status >= 500)

      if (!shouldRetry) throw error

      const advised =
        parseRetryAfter(response.headers.get('retry-after')) ??
        (error.retry_after === undefined ? null : error.retry_after * 1000)
      if (advised !== null && advised > MAX_ADVISED_DELAY_MS) throw error

      await sleep(advised ?? backoffMs(attempt, this.#baseBackoffMs), options.signal)
    }
  }

  async #decode<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T
    const text = await response.text()
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new MailySendError(
        { message: 'The API returned a body that was not JSON.', code: 'internal_error' },
        { status: response.status, raw: text },
      )
    }
  }

  async #toError(response: Response): Promise<MailySendError> {
    const requestId =
      response.headers.get('mailysend-request-id') ?? response.headers.get('cf-ray') ?? undefined
    let raw: unknown
    try {
      raw = await response.json()
    } catch {
      raw = undefined
    }

    const body = isPlainObject(raw) ? (raw as Partial<ErrorBody>) : {}
    return new MailySendError(
      {
        ...body,
        message:
          typeof body.message === 'string' && body.message
            ? body.message
            : `Request failed with status ${response.status}.`,
        statusCode: typeof body.statusCode === 'number' ? body.statusCode : response.status,
      },
      { status: response.status, requestId, raw },
    )
  }
}
