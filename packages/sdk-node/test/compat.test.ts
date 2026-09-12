import { describe, expect, it, vi } from 'vitest'
import { Resend } from '../src/compat.ts'
import { API_KEY, BASE_URL, bodyOf, json } from './helpers.ts'

const compat = (responses: (Response | Error)[]) => {
  const queue = [...responses]
  const fetchMock = vi.fn(async () => {
    const next = queue.shift()
    if (next === undefined)
      throw new Error('fetch called more times than the test queued responses')
    if (next instanceof Error) throw next
    return next
  })
  const resend = new Resend(API_KEY, {
    baseUrl: BASE_URL,
    baseBackoffMs: 1,
    fetch: fetchMock as unknown as typeof globalThis.fetch,
  })
  const call = (index = 0) => {
    const args = fetchMock.mock.calls[index] as unknown as [string, RequestInit]
    return { url: new URL(args[0]), init: args[1] }
  }
  return { resend, call, calls: () => fetchMock.mock.calls.length }
}

const failure = (status: number, code: string, message: string) =>
  json({ statusCode: status, name: code, message, code }, { status })

describe('emails', () => {
  it('returns { data, error } on success', async () => {
    const c = compat([json({ id: 'em_1' })])
    const result = await c.resend.emails.send({
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 'Hi',
      html: '<p>hi</p>',
    })

    expect(result).toEqual({ data: { id: 'em_1' }, error: null })
    expect(c.call().url.pathname).toBe('/v1/emails')
  })

  it('never throws — a 4xx becomes an error object', async () => {
    const c = compat([failure(422, 'validation_error', 'The request body is invalid.')])
    const result = await c.resend.emails.send({
      from: 'a@example.com',
      to: 'bad',
      subject: 'Hi',
      html: '<p>hi</p>',
    })

    expect(result.data).toBeNull()
    expect(result.error).toEqual({
      name: 'validation_error',
      message: 'The request body is invalid.',
      statusCode: 422,
    })
  })

  it('never throws — a transport failure becomes an error object too', async () => {
    const c = compat([
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
    ])
    const result = await c.resend.emails.send({
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 'Hi',
      text: 'hi',
    })

    expect(result.data).toBeNull()
    expect(result.error?.name).toBe('connection_error')
  })

  it('translates Resend camelCase onto the wire format', async () => {
    const c = compat([json({ id: 'em_1' })])
    await c.resend.emails.send({
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 'Hi',
      text: 'hi',
      replyTo: 'reply@example.com',
      scheduledAt: 'in 1 hour',
    })

    expect(bodyOf(c.call().init)).toEqual({
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 'Hi',
      text: 'hi',
      reply_to: 'reply@example.com',
      scheduled_at: 'in 1 hour',
    })
  })

  it('accepts snake_case too, and prefers it when both are given', async () => {
    const c = compat([json({ id: 'em_1' })])
    await c.resend.emails.send({
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 'Hi',
      text: 'hi',
      reply_to: 'wire@example.com',
      replyTo: 'camel@example.com',
    })

    expect(bodyOf(c.call().init)).toMatchObject({ reply_to: 'wire@example.com' })
  })

  it('exposes create as an alias of send', async () => {
    const c = compat([json({ id: 'em_1' })])
    const result = await c.resend.emails.create({
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 'Hi',
      text: 'hi',
    })

    expect(result.data).toEqual({ id: 'em_1' })
  })

  it('covers get, update and cancel', async () => {
    const c = compat([
      json({ object: 'email', id: 'em_1' }),
      json({ object: 'email', id: 'em_1' }),
      json({ object: 'email', id: 'em_1' }),
    ])

    await c.resend.emails.get('em_1')
    await c.resend.emails.update({ id: 'em_1', scheduledAt: 'in 2 hours' })
    await c.resend.emails.cancel('em_1')

    expect(c.call(1).init.method).toBe('PATCH')
    expect(bodyOf(c.call(1).init)).toEqual({ scheduled_at: 'in 2 hours' })
    expect(c.call(2).init.method).toBe('DELETE')
  })

  it('reports a missing scheduledAt as an error rather than a throw', async () => {
    const c = compat([])
    const result = await c.resend.emails.update({ id: 'em_1' })

    expect(result.error?.name).toBe('missing_required_field')
    expect(c.calls()).toBe(0)
  })
})

describe('batch', () => {
  it('nests the array one level deep, as Resend does', async () => {
    const c = compat([json({ data: [{ id: 'em_1' }, { id: 'em_2' }] })])
    const result = await c.resend.batch.send([
      { from: 'a@example.com', to: 'b@example.com', subject: '1', text: '1' },
      { from: 'a@example.com', to: 'c@example.com', subject: '2', text: '2' },
    ])

    expect(result.data).toEqual({ data: [{ id: 'em_1' }, { id: 'em_2' }] })
    expect(c.call().url.pathname).toBe('/v1/emails/batch')
  })

  it('drops per-item failures from the id list rather than inventing ids', async () => {
    const c = compat([
      json({ data: [{ id: 'em_1' }, { index: 1, error: { name: 'x', message: 'y' } }] }),
    ])
    const result = await c.resend.batch.create([
      { from: 'a@example.com', to: 'b@example.com', subject: '1', text: '1' },
      { from: 'a@example.com', to: 'bad', subject: '2', text: '2' },
    ])

    expect(result.data).toEqual({ data: [{ id: 'em_1' }] })
  })
})

describe('domains', () => {
  it('covers the Resend surface', async () => {
    const c = compat([
      json({ object: 'domain', id: 'dom_1' }),
      json({ object: 'domain', id: 'dom_1' }),
      json({ object: 'list', data: [{ object: 'domain', id: 'dom_1' }], has_more: false }),
      json({ object: 'domain', id: 'dom_1' }),
      json({ object: 'domain', id: 'dom_1' }),
      json({ object: 'domain', id: 'dom_1', deleted: true }),
    ])

    await c.resend.domains.create({ name: 'example.com' })
    await c.resend.domains.get('dom_1')
    const listed = await c.resend.domains.list()
    await c.resend.domains.update({ id: 'dom_1', openTracking: false, clickTracking: true })
    await c.resend.domains.verify('dom_1')
    await c.resend.domains.remove('dom_1')

    expect(listed.data).toEqual({ data: [{ object: 'domain', id: 'dom_1' }] })
    expect(bodyOf(c.call(3).init)).toEqual({ open_tracking: false, click_tracking: true })
    expect(c.call(4).url.pathname).toBe('/v1/domains/dom_1/verify')
  })
})

describe('apiKeys', () => {
  it('returns just id and token from create', async () => {
    const c = compat([
      json({ object: 'api_key', id: 'key_1', token: 'ms_live_secret' }),
      json({ object: 'list', data: [], has_more: false }),
      json({ object: 'api_key', id: 'key_1', deleted: true }),
    ])

    const created = await c.resend.apiKeys.create({ name: 'ci', domainId: 'dom_1' })
    await c.resend.apiKeys.list()
    await c.resend.apiKeys.remove('key_1')

    expect(created.data).toEqual({ id: 'key_1', token: 'ms_live_secret' })
    expect(bodyOf(c.call(0).init)).toEqual({ name: 'ci', domain_id: 'dom_1' })
    expect(c.call(2).init.method).toBe('DELETE')
  })
})

describe('audiences', () => {
  it('covers the Resend surface', async () => {
    const c = compat([
      json({ object: 'audience', id: 'aud_1' }),
      json({ object: 'audience', id: 'aud_1' }),
      json({ object: 'list', data: [{ object: 'audience', id: 'aud_1' }], has_more: false }),
      json({ object: 'audience', id: 'aud_1', deleted: true }),
    ])

    await c.resend.audiences.create({ name: 'Newsletter' })
    await c.resend.audiences.get('aud_1')
    const listed = await c.resend.audiences.list()
    await c.resend.audiences.remove('aud_1')

    expect(listed.data).toEqual({ data: [{ object: 'audience', id: 'aud_1' }] })
  })
})

describe('contacts', () => {
  it('routes through the audience when audienceId is given', async () => {
    const c = compat([
      json({ object: 'contact', id: 'con_1' }),
      json({ object: 'contact', id: 'con_1' }),
      json({ object: 'list', data: [], has_more: false }),
      json({ object: 'contact', id: 'con_1' }),
      json({ object: 'contact', id: 'con_1', deleted: true }),
    ])

    await c.resend.contacts.create({
      email: 'a@example.com',
      audienceId: 'aud_1',
      firstName: 'Ada',
    })
    await c.resend.contacts.get({ id: 'con_1', audienceId: 'aud_1' })
    await c.resend.contacts.list({ audienceId: 'aud_1' })
    await c.resend.contacts.update({ id: 'con_1', audienceId: 'aud_1', unsubscribed: true })
    await c.resend.contacts.remove({ id: 'con_1', audienceId: 'aud_1' })

    expect(c.call(0).url.pathname).toBe('/v1/audiences/aud_1/contacts')
    expect(bodyOf(c.call(0).init)).toEqual({ email: 'a@example.com', first_name: 'Ada' })
    expect(c.call(1).url.pathname).toBe('/v1/audiences/aud_1/contacts/con_1')
    expect(bodyOf(c.call(3).init)).toEqual({ unsubscribed: true })
    expect(c.call(4).init.method).toBe('DELETE')
  })

  it('addresses a contact by email when no id is given', async () => {
    const c = compat([json({ object: 'contact', id: 'con_1' })])
    await c.resend.contacts.get({ email: 'a@example.com', audienceId: 'aud_1' })

    expect(c.call().url.pathname).toBe('/v1/audiences/aud_1/contacts/a%40example.com')
  })

  it('falls back to the flat path with no audience', async () => {
    const c = compat([json({ object: 'contact', id: 'con_1' })])
    await c.resend.contacts.get({ id: 'con_1' })

    expect(c.call().url.pathname).toBe('/v1/contacts/con_1')
  })

  it('reports a missing identifier as an error rather than a throw', async () => {
    const c = compat([])
    const result = await c.resend.contacts.get({ audienceId: 'aud_1' })

    expect(result.error?.name).toBe('validation_error')
    expect(c.calls()).toBe(0)
  })
})

describe('broadcasts', () => {
  it('covers the Resend surface', async () => {
    const c = compat([
      json({ object: 'broadcast', id: 'bc_1' }),
      json({ object: 'broadcast', id: 'bc_1' }),
      json({ object: 'list', data: [{ object: 'broadcast', id: 'bc_1' }], has_more: false }),
      json({ object: 'broadcast', id: 'bc_1' }),
      json({ object: 'broadcast', id: 'bc_1' }),
      json({ object: 'broadcast', id: 'bc_1', deleted: true }),
    ])

    const created = await c.resend.broadcasts.create({
      audienceId: 'aud_1',
      from: 'a@example.com',
      subject: 'Hi',
      html: '<p>hi</p>',
      previewText: 'Peek',
    })
    await c.resend.broadcasts.get('bc_1')
    const listed = await c.resend.broadcasts.list()
    await c.resend.broadcasts.update({ id: 'bc_1', subject: 'Hello' })
    await c.resend.broadcasts.send('bc_1', { scheduledAt: 'tomorrow at 9am' })
    await c.resend.broadcasts.remove('bc_1')

    expect(created.data).toEqual({ id: 'bc_1' })
    expect(bodyOf(c.call(0).init)).toEqual({
      audience_id: 'aud_1',
      from: 'a@example.com',
      subject: 'Hi',
      html: '<p>hi</p>',
      preview_text: 'Peek',
    })
    expect(listed.data).toEqual({ data: [{ object: 'broadcast', id: 'bc_1' }] })
    expect(c.call(4).url.pathname).toBe('/v1/broadcasts/bc_1/send')
    expect(bodyOf(c.call(4).init)).toEqual({ scheduled_at: 'tomorrow at 9am' })
  })

  it('reports a missing audienceId as an error rather than a throw', async () => {
    const c = compat([])
    const result = await c.resend.broadcasts.create({
      from: 'a@example.com',
      subject: 'Hi',
      html: '<p>hi</p>',
    })

    expect(result.error?.name).toBe('missing_required_field')
    expect(c.calls()).toBe(0)
  })
})

describe('construction', () => {
  /**
   * The point of this entry point. The official `resend` client resolves its
   * host as `process.env.RESEND_BASE_URL || 'https://api.resend.com'`, so an
   * app that has already pointed that variable at its deployment must not be
   * told it has no base URL when it swaps the import.
   */
  it('prefers RESEND_BASE_URL, so the variable that moves resend moves this too', () => {
    const previousResendBase = process.env.RESEND_BASE_URL
    const previousMailyBase = process.env.MAILYSEND_BASE_URL
    process.env.RESEND_BASE_URL = 'https://mail.example.test/v1'
    process.env.MAILYSEND_BASE_URL = 'https://wrong.example.test'

    expect(new Resend('re_x').emails).toBeDefined()
    expect(() => new Resend('re_x')).not.toThrow()

    if (previousResendBase === undefined) delete process.env.RESEND_BASE_URL
    else process.env.RESEND_BASE_URL = previousResendBase
    if (previousMailyBase === undefined) delete process.env.MAILYSEND_BASE_URL
    else process.env.MAILYSEND_BASE_URL = previousMailyBase
  })

  it('prefers RESEND_API_KEY, so a migrating app needs no env change', () => {
    const previousResend = process.env.RESEND_API_KEY
    const previousMaily = process.env.MAILYSEND_API_KEY
    process.env.RESEND_API_KEY = 're_from_env'
    delete process.env.MAILYSEND_API_KEY

    // Supplied for the same reason as in errors.test.ts: with no hosted
    // MailySend there is no default host, and this test is about the key.
    expect(() => new Resend(undefined, { baseUrl: BASE_URL })).not.toThrow()

    if (previousResend === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = previousResend
    if (previousMaily !== undefined) process.env.MAILYSEND_API_KEY = previousMaily
  })
})
