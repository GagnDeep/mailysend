import { beforeEach, describe, expect, it } from 'vitest'
import { claimFor, type Harness, harness, sessionFor } from './harness.ts'

/**
 * `GET /v1/emails?q=` — the search the command palette was already asking for.
 *
 * The palette sent `q` and this endpoint read `limit`, `cursor` and `status`,
 * so ⌘K showed the five newest messages whatever was typed into it and nothing
 * older than those five could be found at all. An accepted-and-ignored query
 * parameter is worse than a rejected one: the search box looked like it worked.
 */

let h: Harness
let cookie: string

beforeEach(async () => {
  h = await harness()
  cookie = await sessionFor(h, await claimFor(h))

  const rows: [string, string, string, string][] = [
    ['em_1', 'Your invoice for October', 'billing@acme.dev', 'ana@example.com'],
    ['em_2', 'Welcome aboard', 'hello@acme.dev', 'bob@example.com'],
    ['em_3', 'Password reset', 'security@acme.dev', 'ana@example.com'],
    ['em_4', '100% off everything', 'offers@acme.dev', 'carol@example.com'],
  ]
  for (const [id, subject, from, to] of rows) {
    await h.sql
      .prepare(
        `INSERT INTO messages
           (id, workspace_id, from_address, to_addresses, subject, status, state_rank,
            environment, created_at)
         VALUES (?, 'ws_default', ?, ?, ?, 'delivered', 40, 'live', '2026-10-20T09:00:00.000Z')`,
      )
      .bind(id, from, JSON.stringify([to]), subject)
      .run()
  }
})

const search = async (query: string) => {
  const res = await h.fetch(`/v1/emails?${query}`, { cookie })
  expect(res.status).toBe(200)
  return (await res.json()).data.map((email: { id: string }) => email.id)
}

describe('searching messages', () => {
  it('matches on the subject', async () => {
    expect(await search('q=invoice')).toEqual(['em_1'])
  })

  it('matches on a recipient', async () => {
    expect((await search('q=ana@example.com')).sort()).toEqual(['em_1', 'em_3'])
  })

  it('matches on the sender', async () => {
    expect(await search('q=security@')).toEqual(['em_3'])
  })

  it('accepts `search` as well, which is what the rest of the API calls it', async () => {
    expect(await search('search=Welcome')).toEqual(['em_2'])
  })

  /**
   * A typed `%` is a percent sign, not "everything". Without the escape this
   * search returns the whole workspace, which reads as a search that matched.
   */
  it('treats a typed wildcard as the character it is', async () => {
    expect(await search('q=100%25%20off')).toEqual(['em_4'])
    expect(await search('q=%25')).toEqual(['em_4'])
  })

  it('still filters by status alongside the search', async () => {
    expect(await search('q=invoice&status=queued')).toEqual([])
  })

  it('lists everything when nothing is searched for', async () => {
    expect(await search('q=')).toHaveLength(4)
    expect(await search('limit=25')).toHaveLength(4)
  })
})
