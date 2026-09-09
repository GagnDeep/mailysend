import { describe, expect, it } from 'vitest'
import { MailySend, MailySendError } from '../src/index.ts'
import { harness, json } from './helpers.ts'

describe('MailySendError', () => {
  it('carries every ErrorBody field plus the transport status and request id', async () => {
    const h = harness([
      json(
        {
          statusCode: 422,
          name: 'invalid_parameter',
          message: 'Subject exceeds 998 characters.',
          code: 'subject_too_long',
          param: 'subject',
          doc_url: 'https://mailysend.com/docs/errors#subject_too_long',
        },
        { status: 422, headers: { 'mailysend-request-id': 'req_abc' } },
      ),
    ])

    const error = await h.client.emails
      .send({ from: 'a@x.com', to: 'b@x.com', subject: 'x'.repeat(1200), text: 'y' })
      .catch((e) => e)

    expect(error).toBeInstanceOf(MailySendError)
    expect(MailySendError.is(error)).toBe(true)
    expect(error.statusCode).toBe(422)
    expect(error.status).toBe(422)
    expect(error.name).toBe('invalid_parameter')
    expect(error.code).toBe('subject_too_long')
    expect(error.param).toBe('subject')
    expect(error.doc_url).toBe('https://mailysend.com/docs/errors#subject_too_long')
    expect(error.requestId).toBe('req_abc')
    expect(error.message).toBe('Subject exceeds 998 characters.')
  })

  it('round-trips back to the wire shape', async () => {
    const h = harness([
      json(
        { statusCode: 404, name: 'not_found', message: 'No such email.', code: 'not_found' },
        { status: 404 },
      ),
    ])

    const error: MailySendError = await h.client.emails.get('em_missing').catch((e) => e)
    expect(error.toBody()).toEqual({
      statusCode: 404,
      name: 'not_found',
      message: 'No such email.',
      code: 'not_found',
    })
  })

  it('degrades gracefully when the body is not the documented shape', async () => {
    const h = harness([new Response('<html>502 Bad Gateway</html>', { status: 502 })])

    const error: MailySendError = await h.client.emails
      .get('em_1', { maxRetries: 0 })
      .catch((e) => e)

    expect(error.statusCode).toBe(502)
    expect(error.code).toBe('internal_error')
    expect(error.message).toContain('502')
  })

  it('rejects a success body that is not JSON rather than returning garbage', async () => {
    const h = harness([new Response('not json', { status: 200 })])

    await expect(h.client.emails.get('em_1')).rejects.toMatchObject({ code: 'internal_error' })
  })
})

describe('construction', () => {
  it('refuses to build a client with no key at all', () => {
    const previous = process.env.MAILYSEND_API_KEY
    const previousResend = process.env.RESEND_API_KEY
    process.env.MAILYSEND_API_KEY = ''
    process.env.RESEND_API_KEY = ''

    expect(() => new MailySend()).toThrow(/Missing API key/)

    if (previous === undefined) delete process.env.MAILYSEND_API_KEY
    else process.env.MAILYSEND_API_KEY = previous
    if (previousResend === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = previousResend
  })

  it('reads MAILYSEND_API_KEY from the environment', () => {
    const previous = process.env.MAILYSEND_API_KEY
    process.env.MAILYSEND_API_KEY = 'ms_live_from_env'

    expect(() => new MailySend()).not.toThrow()

    if (previous === undefined) delete process.env.MAILYSEND_API_KEY
    else process.env.MAILYSEND_API_KEY = previous
  })
})
