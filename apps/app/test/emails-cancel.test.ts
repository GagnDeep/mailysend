import { beforeEach, describe, expect, it } from 'vitest'
import { claimFor, type Harness, harness, sessionFor } from './harness.ts'

/**
 * Cancelling a scheduled send.
 *
 * `DELETE /v1/emails/:id` was registered; `POST /v1/emails/:id/cancel`, which
 * is both what Resend's clients call and what this dashboard's own API client
 * called, was not. So the Cancel button on a scheduled message 404'd, and the
 * promise the compose screen makes — "cancellable until the moment it leaves" —
 * was only true through the SDK.
 *
 * Both spellings now run the same handler, and both are tested, because the
 * reason there are two is compatibility: dropping either one silently breaks a
 * caller that has no other way to say it.
 */

let h: Harness
let cookie: string

const scheduled = async (id: string, status = 'scheduled') => {
  await h.sql
    .prepare(
      `INSERT INTO messages
         (id, workspace_id, from_address, to_addresses, subject, status, state_rank,
          environment, scheduled_at, created_at)
       VALUES (?, 'ws_default', 'hello@acme.dev', '["ana@example.com"]', 'Later', ?, 15,
               'live', '2026-12-01T09:00:00.000Z', '2026-10-20T09:00:00.000Z')`,
    )
    .bind(id, status)
    .run()
}

const statusOf = async (id: string) =>
  (
    await h.sql
      .prepare('SELECT status FROM messages WHERE id = ?')
      .bind(id)
      .first<{ status: string }>()
  )?.status

beforeEach(async () => {
  h = await harness()
  cookie = await sessionFor(h, await claimFor(h))
})

describe('cancelling a scheduled message', () => {
  it('cancels through the Resend-compatible path', async () => {
    await scheduled('em_CANCEL_POST')
    const res = await h.fetch('/v1/emails/em_CANCEL_POST/cancel', { method: 'POST', cookie })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'em_CANCEL_POST', status: 'canceled' })
    expect(await statusOf('em_CANCEL_POST')).toBe('canceled')
  })

  it('cancels through DELETE as well', async () => {
    await scheduled('em_CANCEL_DELETE')
    const res = await h.fetch('/v1/emails/em_CANCEL_DELETE', { method: 'DELETE', cookie })
    expect(res.status).toBe(200)
    expect(await statusOf('em_CANCEL_DELETE')).toBe('canceled')
  })

  it('refuses a message that has already left, and says so', async () => {
    await scheduled('em_ALREADY_SENT', 'sent')
    const res = await h.fetch('/v1/emails/em_ALREADY_SENT/cancel', { method: 'POST', cookie })
    expect(res.status).toBe(404)
    expect(JSON.stringify(await res.json())).toContain('Only a scheduled message')
    expect(await statusOf('em_ALREADY_SENT')).toBe('sent')
  })
})
