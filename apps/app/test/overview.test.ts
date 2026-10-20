import { beforeEach, describe, expect, it } from 'vitest'
import { claimFor, type Harness, harness, sessionFor } from './harness.ts'

/**
 * The Overview's queue panel, from the data up.
 *
 * The panel drew a green pulsing dot and the words "Send queue drained" on
 * every load, with no query behind them — so it said the same thing on the load
 * where a misconfigured transport had ten thousand messages stacked up behind
 * it. These are the facts it now reports instead, and the reason they are
 * asserted here rather than in a component test is that the lie was in the
 * absence of a query, not in the markup.
 */

let h: Harness
let cookie: string

beforeEach(async () => {
  h = await harness()
  cookie = await sessionFor(h, await claimFor(h))
})

const message = (
  id: string,
  status: string,
  createdAt: string,
  scheduledAt: string | null = null,
) =>
  h.sql
    .prepare(
      `INSERT INTO messages
         (id, workspace_id, from_address, to_addresses, subject, status, state_rank,
          environment, created_at, scheduled_at)
       VALUES (?, 'ws_default', 'info@acme.dev', '["someone@example.com"]', 'Hello', ?, 10,
               'live', ?, ?)`,
    )
    .bind(id, status, createdAt, scheduledAt)
    .run()

const queue = async () => {
  const res = await h.fetch('/v1/analytics/dashboard', { cookie })
  expect(res.status).toBe(200)
  return (await res.json()).queue
}

describe('live queue depth', () => {
  it('reports zero across the board on an instance that has sent nothing', async () => {
    expect(await queue()).toEqual({
      queued: 0,
      sending: 0,
      scheduled: 0,
      oldest_waiting_at: null,
      next_scheduled_at: null,
    })
  })

  it('counts each waiting state separately', async () => {
    await message('em_1', 'queued', '2026-10-20T09:00:00.000Z')
    await message('em_2', 'queued', '2026-10-20T09:01:00.000Z')
    await message('em_3', 'sending', '2026-10-20T09:02:00.000Z')
    await message('em_4', 'scheduled', '2026-10-20T09:03:00.000Z', '2026-10-21T07:00:00.000Z')

    const q = await queue()
    expect(q.queued).toBe(2)
    expect(q.sending).toBe(1)
    expect(q.scheduled).toBe(1)
    expect(q.next_scheduled_at).toBe('2026-10-21T07:00:00.000Z')
  })

  /** The one number that separates a queue that is moving from one that is stuck. */
  it('names when the oldest thing still waiting was accepted', async () => {
    await message('em_old', 'queued', '2026-10-20T08:00:00.000Z')
    await message('em_new', 'queued', '2026-10-20T09:00:00.000Z')

    expect((await queue()).oldest_waiting_at).toBe('2026-10-20T08:00:00.000Z')
  })

  /** Delivered mail is not a backlog, and the panel must not read as one. */
  it('ignores messages that have already left', async () => {
    await message('em_done', 'delivered', '2026-10-20T09:00:00.000Z')
    await message('em_gone', 'failed', '2026-10-20T09:00:00.000Z')

    const q = await queue()
    expect(q.queued + q.sending + q.scheduled).toBe(0)
    expect(q.oldest_waiting_at).toBeNull()
  })

  /**
   * Test traffic piling up must not make the live panel look stuck, and the
   * reverse. Every other number on this screen is environment-scoped; this one
   * is read from a different table and had to be scoped separately.
   */
  it('keeps the two environments apart', async () => {
    await h.sql
      .prepare(
        `INSERT INTO messages
           (id, workspace_id, from_address, to_addresses, subject, status, state_rank,
            environment, created_at)
         VALUES ('em_test', 'ws_default', 'info@acme.dev', '["someone@example.com"]', 'Hello',
                 'queued', 10, 'test', '2026-10-20T09:00:00.000Z')`,
      )
      .run()

    expect((await queue()).queued).toBe(0)
  })
})
