import { describe, expect, it, vi } from 'vitest'
import { consumeEventQueue } from '../src/server/consumers/events.ts'
import { harness } from './harness.ts'

describe('Cloudflare Email Sending event subscriptions', () => {
  it('normalizes a native Cloudflare delivery event and updates its message', async () => {
    const h = await harness()
    const now = new Date().toISOString()
    await h.sql
      .prepare(
        `INSERT INTO messages
          (id, workspace_id, from_address, to_addresses, subject, status, state_rank, provider,
           provider_message_id, environment, created_at)
         VALUES (?,?,?,?,?,'sent',20,'cloudflare',?,'live',?)`,
      )
      .bind(
        'email_01TESTCLOUDFLARE000001',
        'ws_default',
        'noreply@acme.dev',
        '["recipient@example.net"]',
        'Delivery test',
        'cf-message-123',
        now,
      )
      .run()

    const ack = vi.fn()
    const retry = vi.fn()
    await consumeEventQueue(
      {
        queue: 'ms-events-cf',
        messages: [
          {
            id: 'queue-message-1',
            timestamp: new Date(),
            attempts: 1,
            body: {
              type: 'cf.email.sending.message.delivered',
              source: { type: 'email.sending', domain: 'acme.dev' },
              payload: {
                messageId: 'cf-message-123',
                recipient: 'recipient@example.net',
                delivery: { smtpStatusCode: '250', smtpResponse: '250 2.0.0 accepted' },
              },
              metadata: { eventTimestamp: now },
            },
            ack,
            retry,
          },
        ],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      },
      h.env,
    )

    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
    await expect(
      h.sql
        .prepare('SELECT status, delivered_at FROM messages WHERE id = ?')
        .bind('email_01TESTCLOUDFLARE000001')
        .first<{ status: string; delivered_at: string | null }>(),
    ).resolves.toMatchObject({ status: 'delivered', delivered_at: now })
  })
})
