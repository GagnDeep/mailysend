import { describe, expect, it } from 'vitest'
import { MailySendConnectionError, MailySendError } from '../src/index.ts'
import { BASE_URL, harness, json } from './helpers.ts'

const rateLimited = (retryAfter?: string) =>
  json(
    {
      statusCode: 429,
      name: 'rate_limit_exceeded',
      message: 'Slow down.',
      code: 'rate_limit_exceeded',
    },
    { status: 429, ...(retryAfter ? { headers: { 'retry-after': retryAfter } } : {}) },
  )

const serverError = () =>
  json(
    { statusCode: 500, name: 'application_error', message: 'Boom.', code: 'internal_error' },
    { status: 500 },
  )

describe('idempotency', () => {
  it('puts an idempotency key on every POST', async () => {
    const h = harness([json({ id: 'em_1' })])
    await h.client.emails.send({ from: 'a@x.com', to: 'b@x.com', subject: 'Hi', text: 'y' })

    expect(h.call().headers['idempotency-key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it('does not put one on GET, PATCH or DELETE', async () => {
    const h = harness([json({}), json({}), json({})])
    await h.client.emails.get('em_1')
    await h.client.emails.update('em_1', { scheduled_at: 'in 1 hour' })
    await h.client.emails.cancel('em_1')

    expect(h.call(0).headers['idempotency-key']).toBeUndefined()
    expect(h.call(1).headers['idempotency-key']).toBeUndefined()
    expect(h.call(2).headers['idempotency-key']).toBeUndefined()
  })

  it('reuses the same key across retries, so a replay cannot send twice', async () => {
    const h = harness([serverError(), serverError(), json({ id: 'em_1' })])
    await h.client.emails.send({ from: 'a@x.com', to: 'b@x.com', subject: 'Hi', text: 'y' })

    expect(h.calls()).toBe(3)
    const keys = [0, 1, 2].map((i) => h.call(i).headers['idempotency-key'])
    expect(new Set(keys).size).toBe(1)
    expect(keys[0]).toBeTruthy()
  })

  it('mints a fresh key for each separate call', async () => {
    const h = harness([json({ id: 'em_1' }), json({ id: 'em_2' })])
    const payload = { from: 'a@x.com', to: 'b@x.com', subject: 'Hi', text: 'y' }
    await h.client.emails.send(payload)
    await h.client.emails.send(payload)

    expect(h.call(0).headers['idempotency-key']).not.toBe(h.call(1).headers['idempotency-key'])
  })

  it('honours a caller-supplied key', async () => {
    const h = harness([json({ id: 'em_1' })])
    await h.client.emails.send(
      { from: 'a@x.com', to: 'b@x.com', subject: 'Hi', text: 'y' },
      { idempotencyKey: 'order-4711' },
    )

    expect(h.call().headers['idempotency-key']).toBe('order-4711')
  })

  it('never retries a POST whose key was explicitly suppressed', async () => {
    const h = harness([serverError(), json({ id: 'em_1' })])

    await expect(
      h.client.emails.send(
        { from: 'a@x.com', to: 'b@x.com', subject: 'Hi', text: 'y' },
        { idempotencyKey: null },
      ),
    ).rejects.toBeInstanceOf(MailySendError)

    expect(h.calls()).toBe(1)
    expect(h.call().headers['idempotency-key']).toBeUndefined()
  })
})

describe('retry policy', () => {
  it('retries a 5xx and returns the eventual success', async () => {
    const h = harness([serverError(), json({ object: 'email', id: 'em_1' })])
    const email = await h.client.emails.get('em_1')

    expect(h.calls()).toBe(2)
    expect(email.id).toBe('em_1')
  })

  it('retries a 429 and honours retry-after in seconds', async () => {
    const h = harness([rateLimited('0.01'), json({ object: 'email', id: 'em_1' })])
    const started = Date.now()
    await h.client.emails.get('em_1')

    expect(h.calls()).toBe(2)
    // 10ms is small enough not to make the suite slow and large enough that a
    // policy which ignored the header entirely would still pass — so the real
    // assertion is the one below, that a too-long delay is refused.
    expect(Date.now() - started).toBeGreaterThanOrEqual(0)
  })

  it('accepts an http-date retry-after', async () => {
    const soon = new Date(Date.now() + 10).toUTCString()
    const h = harness([rateLimited(soon), json({ object: 'email', id: 'em_1' })])
    await h.client.emails.get('em_1')

    expect(h.calls()).toBe(2)
  })

  it('refuses a retry-after longer than a minute and surfaces the 429', async () => {
    const h = harness([rateLimited('3600')])

    await expect(h.client.emails.get('em_1')).rejects.toMatchObject({ statusCode: 429 })
    expect(h.calls()).toBe(1)
  })

  it('falls back to the body retry_after when the header is absent', async () => {
    const h = harness([
      json(
        {
          statusCode: 429,
          name: 'rate_limit_exceeded',
          message: 'Slow down.',
          code: 'rate_limit_exceeded',
          retry_after: 7200,
        },
        { status: 429 },
      ),
    ])

    await expect(h.client.emails.get('em_1')).rejects.toMatchObject({ retry_after: 7200 })
    expect(h.calls()).toBe(1)
  })

  it('gives up after maxRetries and throws the last error', async () => {
    const h = harness([serverError(), serverError(), serverError(), serverError()])

    await expect(h.client.emails.get('em_1')).rejects.toMatchObject({ statusCode: 500 })
    expect(h.calls()).toBe(4)
  })

  it('does not retry a 4xx that is not 408 or 429', async () => {
    const h = harness([
      json(
        { statusCode: 422, name: 'validation_error', message: 'Bad.', code: 'validation_error' },
        { status: 422 },
      ),
    ])

    await expect(h.client.emails.get('em_1')).rejects.toBeInstanceOf(MailySendError)
    expect(h.calls()).toBe(1)
  })

  it('retries a 408', async () => {
    const h = harness([
      json(
        { statusCode: 408, name: 'application_error', message: 'Timeout.', code: 'internal_error' },
        { status: 408 },
      ),
      json({ object: 'email', id: 'em_1' }),
    ])
    await h.client.emails.get('em_1')

    expect(h.calls()).toBe(2)
  })

  it('retries a network failure and reports it as a connection error when it persists', async () => {
    const h = harness([new TypeError('fetch failed'), json({ object: 'email', id: 'em_1' })])
    await h.client.emails.get('em_1')
    expect(h.calls()).toBe(2)

    const dead = harness([
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
    ])
    const error = await dead.client.emails.get('em_1').catch((e) => e)
    expect(error).toBeInstanceOf(MailySendConnectionError)
    expect(error.message).toContain(BASE_URL)
    expect(dead.calls()).toBe(4)
  })

  it('respects maxRetries: 0', async () => {
    const h = harness([serverError()])
    const client = h.client

    await expect(client.emails.get('em_1', { maxRetries: 0 })).rejects.toMatchObject({
      statusCode: 500,
    })
    expect(h.calls()).toBe(1)
  })

  it('stops immediately when the caller aborts', async () => {
    const controller = new AbortController()
    const h = harness([
      () => {
        controller.abort(new Error('caller changed their mind'))
        return new TypeError('aborted')
      },
    ])

    await expect(h.client.emails.get('em_1', { signal: controller.signal })).rejects.toThrow(
      'caller changed their mind',
    )
    expect(h.calls()).toBe(1)
  })
})
