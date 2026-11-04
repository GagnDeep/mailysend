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

/**
 * The half that is not a preference.
 *
 * Gmail and Yahoo require one-click unsubscribe from bulk senders, so a
 * broadcast carries the headers whatever the domain says — the opt-in above
 * governs individual mail only. That rule lives in one boolean inside
 * `buildOutbound`, where a later refactor could drop the `broadcast_id` half of
 * it and break nothing a test was watching. So this drives the consumer with a
 * broadcast envelope and reads the headers off the transport.
 */
describe('a broadcast is bulk mail whether or not the domain opted in', () => {
  it('sends List-Unsubscribe from a domain with the switch off', async () => {
    const h = await harness()
    const domainId = await verifiedDomain(h, 'acme.dev')
    const sent: { headers?: Record<string, string> }[] = []
    h.env.SEND_EMAIL = {
      send: async (message: unknown) => {
        sent.push(message as { headers?: Record<string, string> })
        return { messageId: 'cf_test' }
      },
    } as never

    // The row the lease is taken against; `deliverNow` claims it before it
    // builds anything, and a message that is not there is never sent.
    const emailId = 'em_BROADCAST_UNSUB'
    await h.sql
      .prepare(
        `INSERT INTO messages
           (id, workspace_id, domain_id, from_address, to_addresses, subject, status, state_rank,
            environment, broadcast_id, created_at)
         VALUES (?, 'ws_default', ?, 'team@acme.dev', '["reader@example.com"]', 'Issue 4',
                 'queued', 10, 'live', 'bcs_1', '2026-11-04T09:00:00.000Z')`,
      )
      .bind(emailId, domainId)
      .run()

    const { deliverNow } = await import('../src/server/send/consumer.ts')
    const { runWithEnv } = await import('../src/server/env.ts')
    const outcome = await runWithEnv(h.env, { waitUntil: () => {} }, () =>
      deliverNow(
        {
          kind: 'inline',
          email_id: emailId,
          workspace_id: 'ws_default',
          envelope: {
            email_id: emailId,
            workspace_id: 'ws_default',
            environment: 'live',
            request: {
              from: 'team@acme.dev',
              to: ['reader@example.com'],
              subject: 'Issue 4',
              html: '<p>Hello</p>',
            },
            domain: {
              id: domainId,
              name: 'acme.dev',
              dkim_selector: 'ms1',
              dkim_private_key: null,
              return_path: 'cf-bounce.acme.dev',
              open_tracking: false,
              click_tracking: false,
              // The switch this PR added, off — as every existing domain is.
              unsubscribe_headers: false,
            },
            broadcast_id: 'bcs_1',
            created_at: '2026-11-04T09:00:00.000Z',
          },
        },
        h.env,
      ),
    )

    expect(outcome.delivered).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/mail\.acme\.dev\/u\/.+>$/)
    expect(sent[0]?.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })
})
