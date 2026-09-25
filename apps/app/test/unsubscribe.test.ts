import { describe, expect, it } from 'vitest'
import { claimFor, type Harness, harness, sessionFor, verifiedDomain } from './harness.ts'

/**
 * `request.html` never goes through Handlebars — `injectUnsubscribe` is the
 * only thing in the send path that resolves `{{unsubscribe_url}}` and its
 * siblings. Gating that substitution on the same opt-in that gates the
 * `List-Unsubscribe` headers meant an unsubscribe_headers=false domain sent
 * the placeholder to the recipient as literal text. The body substitution
 * must run on every send; only the headers are opt-in.
 */

async function sendCapturing(h: Harness, cookie: string, html: string) {
  const sent: { html?: string; headers?: Record<string, string> }[] = []
  h.env.SEND_EMAIL = {
    send: async (message: unknown) => {
      sent.push(message as { html?: string; headers?: Record<string, string> })
      return { messageId: 'cf_test' }
    },
  } as never

  const res = await h.fetch('/v1/mail/send', {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      from: 'team@acme.dev',
      to: ['someone@example.com'],
      subject: 'Placeholder check',
      html,
    }),
  })
  expect(res.status).toBe(200)
  expect(sent).toHaveLength(1)
  return sent[0]!
}

describe('unsubscribe placeholder substitution', () => {
  it('resolves {{unsubscribe_url}} in the body even when headers are not opted in', async () => {
    const h = await harness()
    await verifiedDomain(h, 'acme.dev')
    const cookie = await sessionFor(h, await claimFor(h))

    const message = await sendCapturing(
      h,
      cookie,
      '<p>Bye: <a href="{{unsubscribe_url}}">unsubscribe</a></p>',
    )

    expect(message.html).not.toContain('{{unsubscribe_url}}')
    expect(message.html).toMatch(/href="https:\/\/mail\.acme\.dev\/u\/[^"]+"/)
    // Headers stay off: this domain never opted into List-Unsubscribe.
    expect(message.headers?.['List-Unsubscribe']).toBeUndefined()
  })

  it('still sends body text untouched when there is no placeholder and no opt-in', async () => {
    const h = await harness()
    await verifiedDomain(h, 'acme.dev')
    const cookie = await sessionFor(h, await claimFor(h))

    const message = await sendCapturing(h, cookie, '<p>No placeholder here.</p>')

    expect(message.html).toBe('<p>No placeholder here.</p>')
    expect(message.headers?.['List-Unsubscribe']).toBeUndefined()
  })

  it('adds List-Unsubscribe headers, and still resolves the placeholder, once opted in', async () => {
    const h = await harness()
    const domainId = await verifiedDomain(h, 'acme.dev')
    await h.sql
      .prepare('UPDATE domains SET unsubscribe_headers = 1 WHERE id = ?')
      .bind(domainId)
      .run()
    const cookie = await sessionFor(h, await claimFor(h))

    const message = await sendCapturing(
      h,
      cookie,
      '<p>Bye: <a href="{{unsubscribe_url}}">unsubscribe</a></p>',
    )

    expect(message.html).not.toContain('{{unsubscribe_url}}')
    expect(message.headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/mail\.acme\.dev\/u\/.+>$/)
    expect(message.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })
})
