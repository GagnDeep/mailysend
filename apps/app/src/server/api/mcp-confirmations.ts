import { apiError } from '@mailysend/contracts'
import { newId } from '@mailysend/core'
import { requireRole } from '../auth.ts'
import type { Ctx } from '../context.ts'
import { SqlApprovals } from '../mcp.ts'
import { clientIp } from '../session.ts'
import { type App, createRouter, json, withContext } from './base.ts'

/**
 * `/v1/mcp/confirmations` — the human half of the agent's confirmation gate.
 *
 * The gate itself has always been complete: an agent's first `send_email` mints
 * a token bound to the payload digest, and the second call redeems it. What was
 * missing was any way for a person to say yes. `SqlApprovals.pending`,
 * `approve` and `reject` were written, tested and had zero callers; the
 * `approval_channel` an agent hands back to its user pointed at a 404. So every
 * agent send in the product's history was permanently stuck at `not_approved`.
 *
 * Approval is deliberately not an MCP method — an agent holding a valid API key
 * must not be able to approve its own send — which is exactly why it has to be
 * an ordinary authenticated HTTP route instead. `requireRole('developer')` and
 * a session-or-key actor are the same authority every other write here uses.
 */
const mcpConfirmations: App = createRouter()

mcpConfirmations.use('*', withContext())

interface Row {
  token: string
  tool: string
  summary: string
  status: string
  decided_by: string | null
  consumed_at: string | null
  created_at: number
  expires_at: number
}

const toJson = (row: Row) => ({
  object: 'mcp_confirmation' as const,
  token: row.token,
  tool: row.tool,
  // Written by the gate as JSON; a row that somehow is not stays readable as a
  // string rather than taking the whole listing down with it.
  summary: parseSummary(row.summary),
  status: row.status,
  decided_by: row.decided_by,
  consumed_at: row.consumed_at,
  created_at: new Date(row.created_at).toISOString(),
  expires_at: new Date(row.expires_at).toISOString(),
  expired: row.expires_at <= Date.now(),
})

function parseSummary(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return { detail: raw }
  }
}

/**
 * `GET /v1/mcp/confirmations` — what this workspace is being asked to approve.
 *
 * Decided and expired rows are included, because "I approved that and nothing
 * happened" needs an answer too — `consumed_at` is the difference between an
 * approval an agent redeemed and one it never came back for.
 */
mcpConfirmations.get('/', async (c) => {
  const ctx = c.get('ctx')
  const status = c.req.query('status') ?? 'pending'
  const clauses = ['workspace_id = ?']
  const args: unknown[] = [ctx.workspace.id]
  if (status !== 'all') {
    clauses.push('status = ?')
    args.push(status)
  }

  const rows = await ctx.sql
    .prepare(
      `SELECT token, tool, summary, status, decided_by, consumed_at, created_at, expires_at
         FROM mcp_confirmations WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC LIMIT 100`,
    )
    .bind(...args)
    .all<Row>()

  return json({
    object: 'list',
    data: rows.results.map(toJson),
    has_more: false,
    next_cursor: null,
  })
})

/**
 * The decision, and the audit row that goes with it.
 *
 * A confirmation is a person authorising a machine to send mail in their name,
 * so it is written to `audit_log` with the actor and the source address — the
 * same treatment claiming the instance gets, and for the same reason.
 */
async function decide(ctx: Ctx, request: Request, token: string, action: 'approve' | 'reject') {
  requireRole(ctx.actor, 'developer')

  const approvals = new SqlApprovals(ctx.sql)
  const pending = await approvals.get(token)
  // Scoped to the workspace before anything else: a token is an opaque string
  // and nothing else about this route would stop one workspace deciding
  // another's.
  if (!pending || pending.workspaceId !== ctx.workspace.id) throw apiError('not_found')

  const by = ctx.actor.userId ?? ctx.actor.apiKeyId ?? 'unknown'
  const ok =
    action === 'approve' ? await approvals.approve(token, by) : await approvals.reject(token, by)
  if (!ok) {
    // `decide` only lands on a row that is still pending and unexpired, so a
    // false here is one of exactly two things and the caller deserves to know
    // which.
    throw apiError('validation_error', {
      message:
        pending.expiresAt <= Date.now()
          ? 'That confirmation has expired. Ask the agent to try again — a stale approval is an approval for a message nobody remembers.'
          : 'That confirmation has already been decided.',
    })
  }

  await ctx.sql
    .prepare(
      `INSERT INTO audit_log (id, workspace_id, actor_type, actor_id, action, resource_type, resource_id, metadata, ip, created_at)
       VALUES (?,?,?,?,?,'mcp_confirmation',?,?,?,?)`,
    )
    .bind(
      newId('event'),
      ctx.workspace.id,
      ctx.actor.userId ? 'user' : 'api_key',
      by,
      `mcp.confirmation.${action}d`,
      token,
      JSON.stringify({ tool: pending.tool, summary: pending.summary }),
      clientIp(request),
      new Date().toISOString(),
    )
    .run()

  return json({
    object: 'mcp_confirmation',
    token,
    tool: pending.tool,
    status: action === 'approve' ? 'approved' : 'rejected',
  })
}

mcpConfirmations.post('/:token/approve', (c) =>
  decide(c.get('ctx'), c.req.raw, c.req.param('token'), 'approve'),
)
mcpConfirmations.post('/:token/reject', (c) =>
  decide(c.get('ctx'), c.req.raw, c.req.param('token'), 'reject'),
)

export { mcpConfirmations }
