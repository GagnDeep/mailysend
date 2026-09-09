import { vi } from 'vitest'
import { MailySend } from '../src/index.ts'

export const API_KEY = 'ms_test_abc123'
export const BASE_URL = 'https://api.example.test'

export const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })

export interface Harness {
  fetch: ReturnType<typeof vi.fn>
  client: MailySend
  /** The single call, asserted to be the only one. */
  call(index?: number): { url: URL; init: RequestInit; headers: Record<string, string> }
  calls(): number
}

/**
 * A client wired to a queue of canned responses. `baseBackoffMs: 1` keeps the
 * retry tests in real time rather than fake timers — the policy under test is
 * "how many attempts and with what headers", and faking the clock to assert
 * that adds machinery without adding coverage.
 */
export const harness = (responses: (Response | Error | (() => Response | Error))[]): Harness => {
  const queue = [...responses]
  const fetchMock = vi.fn(async () => {
    const next = queue.shift()
    if (next === undefined)
      throw new Error('fetch called more times than the test queued responses')
    const resolved = typeof next === 'function' ? next() : next
    if (resolved instanceof Error) throw resolved
    return resolved
  })

  const client = new MailySend(API_KEY, {
    baseUrl: BASE_URL,
    baseBackoffMs: 1,
    fetch: fetchMock as unknown as typeof globalThis.fetch,
  })

  return {
    fetch: fetchMock,
    client,
    calls: () => fetchMock.mock.calls.length,
    call(index = 0) {
      const args = fetchMock.mock.calls[index] as unknown as [string, RequestInit] | undefined
      if (!args) throw new Error(`no fetch call at index ${index}`)
      const [url, init] = args
      return { url: new URL(url), init, headers: init.headers as Record<string, string> }
    },
  }
}

export const bodyOf = (init: RequestInit): unknown =>
  init.body === undefined ? undefined : JSON.parse(init.body as string)
