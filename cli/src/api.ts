import type { ErrorBody } from '@mailysend/contracts'
import type { Credentials } from './config.ts'

/**
 * The API client the commands share.
 *
 * Deliberately thinner than `mailysend` (the SDK): the CLI is an interactive
 * tool where a failed call should stop and explain itself, not retry silently
 * behind a spinner. The one thing it does share is the error shape — every
 * failure surfaces as an `ApiCallError` carrying the server's `ErrorBody`, so
 * `mailysend` can print the server's own message rather than a paraphrase.
 */

export class ApiCallError extends Error {
  readonly status: number
  readonly body: Partial<ErrorBody>

  constructor(status: number, body: Partial<ErrorBody>) {
    super(body.message ?? `Request failed with ${status}`)
    this.name = 'ApiCallError'
    this.status = status
    this.body = body
  }
}

export interface RequestOptions {
  method?: string
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string>
  signal?: AbortSignal
}

export class ApiClient {
  readonly baseUrl: string
  readonly #apiKey: string

  constructor(credentials: Credentials) {
    this.baseUrl = credentials.baseUrl.replace(/\/+$/, '')
    this.#apiKey = credentials.apiKey
  }

  url(path: string, query: RequestOptions['query'] = {}): string {
    const url = new URL(`${this.baseUrl}/v1${path}`)
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET'
    const response = await fetch(this.url(path, options.query), {
      method,
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        // A CLI retry is a human pressing up-arrow, and a human should never
        // create two messages by doing so.
        ...(method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      ...(options.signal ? { signal: options.signal } : {}),
    })

    if (response.status === 204) return undefined as T

    const text = await response.text()
    const parsed = text === '' ? {} : safeJson(text)

    if (!response.ok) {
      throw new ApiCallError(response.status, (parsed ?? { message: text }) as Partial<ErrorBody>)
    }
    return parsed as T
  }

  get<T>(path: string, query?: RequestOptions['query']) {
    return this.request<T>(path, query === undefined ? {} : { query })
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: 'POST', body })
  }

  patch<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: 'PATCH', body })
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: 'DELETE' })
  }

  /** Walks a keyset-paginated list to completion, yielding pages. */
  async *pages<T>(path: string, query: RequestOptions['query'] = {}, limit = 100) {
    let cursor: string | undefined
    for (;;) {
      const page = await this.get<{ data: T[]; has_more?: boolean; next_cursor?: string | null }>(
        path,
        { ...query, limit, after: cursor },
      )
      yield page.data ?? []
      if (!page.has_more || !page.next_cursor) return
      cursor = page.next_cursor
    }
  }
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return { message: text.slice(0, 400) }
  }
}
