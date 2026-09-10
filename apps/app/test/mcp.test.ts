import { beforeEach, describe, expect, it } from 'vitest'
import { SqlApprovals } from '../src/server/mcp.ts'
import { claimFor, type Harness, harness, sessionFor } from './harness.ts'

/**
 * The half of the confirmation gate a person operates.
 *
 * The cryptographic half has always worked: an agent's first `send_email`
 * mints a token and the second redeems it. Nothing could approve one — the
 * `approval_channel` handed to the agent's user was a hardcoded 404 and
 * `SqlApprovals.pending/approve/reject` had no callers at all — so every agent
 * send this product ever attempted ended at `not_approved`. These tests are
 * about that route existing and refusing the things it must refuse.
 */

let h: Harness
let cookie: string
let approvals: SqlApprovals

const summary = {
  tool: 'send_email' as const,
  from: 'bot@acme.dev',
  to: ['ana@example.com'],
  cc: [],
  bcc: [],
  reply_to: [],
  subject: 'Your order',
  preview: 'It shipped this morning.',
  attachment_count: 0,
  tag_count: 0,
  scheduled_at: null,
  template_id: null,
}

async function mint(token: string, opts: { workspaceId?: string; expiresAt?: number } = {}) {
  await approvals.mint({
    token,
    tool: 'send_email',
    workspaceId: opts.workspaceId ?? 'ws_default',
    summary,
    createdAt: Date.now(),
    expiresAt: opts.expiresAt ?? Date.now() + 600_000,
  })
}

beforeEach(async () => {
  h = await harness()
  cookie = await sessionFor(h, await claimFor(h))
  approvals = new SqlApprovals(h.sql)
})

const list = async (query = '') => {
  const res = await h.fetch(`/v1/mcp/confirmations${query}`, { cookie })
  expect(res.status).toBe(200)
  return (await res.json()) as {
    data: { token: string; tool: string; status: string; expired: boolean; summary: unknown }[]
  }
}

describe('the approvals queue', () => {
  it('lists a minted confirmation with the summary frozen at mint time', async () => {
    await mint('cnf_one')
    const body = await list()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({ token: 'cnf_one', tool: 'send_email', status: 'pending' })
    expect(body.data[0]?.summary).toMatchObject({ subject: 'Your order' })
  })

  it('approves, and the token becomes spendable exactly once', async () => {
    await mint('cnf_two')
    const res = await h.fetch('/v1/mcp/confirmations/cnf_two/approve', { method: 'POST', cookie })
    expect(res.status).toBe(200)
    expect(await approvals.isApproved('cnf_two')).toBe(true)

    // A second decision on a decided token does not land — an approve arriving
    // after a reject must not overwrite it.
    const again = await h.fetch('/v1/mcp/confirmations/cnf_two/reject', { method: 'POST', cookie })
    expect(again.status).toBe(422)
    expect(await approvals.isApproved('cnf_two')).toBe(true)
  })

  it('blocks a rejected token', async () => {
    await mint('cnf_three')
    const res = await h.fetch('/v1/mcp/confirmations/cnf_three/reject', { method: 'POST', cookie })
    expect(res.status).toBe(200)
    expect(await approvals.isApproved('cnf_three')).toBe(false)
  })

  it('will not decide another workspace’s token', async () => {
    await mint('cnf_other', { workspaceId: 'ws_someone_else' })
    const res = await h.fetch('/v1/mcp/confirmations/cnf_other/approve', { method: 'POST', cookie })
    expect(res.status).toBe(404)
    expect(await approvals.isApproved('cnf_other')).toBe(false)

    const body = await list('?status=all')
    expect(body.data).toHaveLength(0)
  })

  it('will not approve one that has already expired', async () => {
    await mint('cnf_stale', { expiresAt: Date.now() - 1000 })
    const res = await h.fetch('/v1/mcp/confirmations/cnf_stale/approve', { method: 'POST', cookie })
    expect(res.status).toBe(422)
    expect(await approvals.isApproved('cnf_stale')).toBe(false)

    // Still shown, marked expired: "I approved that and nothing happened" needs
    // an answer as much as a pending one does.
    const body = await list('?status=all')
    expect(body.data[0]).toMatchObject({ token: 'cnf_stale', expired: true })
  })

  it('leaves an audit trail of who decided', async () => {
    await mint('cnf_audit')
    await h.fetch('/v1/mcp/confirmations/cnf_audit/approve', { method: 'POST', cookie })
    const row = await h.sql
      .prepare(`SELECT action FROM audit_log WHERE action LIKE 'mcp%' ORDER BY created_at DESC`)
      .first<{ action: string }>()
    expect(row?.action).toContain('mcp')
  })
})

describe('the nightly sweep', () => {
  it('reaches mcp_confirmations, which it claimed to and did not', async () => {
    await mint('cnf_old', { expiresAt: Date.now() - 7 * 24 * 3600_000 })
    await mint('cnf_live')
    const { runCron } = await import('../src/server/cron.ts')
    await runCron('* * * * *', h.env)
    const rows = await h.sql.prepare('SELECT token FROM mcp_confirmations').all<{ token: string }>()
    expect(rows.results.map((r) => r.token)).toEqual(['cnf_live'])
  })
})
