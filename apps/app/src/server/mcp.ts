import type { Contact, Domain } from '@mailysend/contracts'
import { hashApiKey } from '@mailysend/core'
import type {
  AnalyticsSummary,
  AuthContext,
  ConfirmationApprovals,
  ConsumedTokens,
  Email,
  EmailListInput,
  EmailListResult,
  McpBackend,
  PendingConfirmation,
  RepliedMessage,
  ReplyPayload,
  SendOptions,
  SendPayload,
  SentEmail,
  StatsInput,
  ThreadDetail,
  ThreadHit,
} from '@mailysend/mcp'
import { McpServer, mcpHttpHandler } from '@mailysend/mcp'
import type { Sql } from '@mailysend/platform'
import { api } from './api/index.ts'
import { bearerToken } from './auth.ts'
import { tenancyFor } from './context.ts'
import { getEnv } from './env.ts'

/**
 * The MCP endpoint.
 *
 * Two decisions shape this file.
 *
 * First, every tool is served by calling our own `/v1` router in-process rather
 * than by reaching into the database. An MCP tool and the REST endpoint behind
 * it can then never disagree — same validation, same scopes, same rate limit,
 * same suppression check — and adding a field to an endpoint adds it to the
 * agent surface for free. The cost is one synthetic Request per call, which is
 * an object allocation, not a network hop.
 *
 * Second, an agent authenticates with an ordinary API key. Revoking an agent is
 * therefore the same operation as revoking anything else, rather than a second
 * permission system nobody remembers to check.
 */
export async function handleMcp(request: Request): Promise<Response> {
  const env = getEnv()
  const sql = tenancyFor(env).db('')
  const token = bearerToken(request) ?? ''

  const server = new McpServer({
    backend: restBackend(request, token),
    auth: {
      resolve: async (keyHash) => {
        const row = await sql
          .prepare(
            `SELECT id, workspace_id, permission, revoked_at, expires_at
               FROM api_keys WHERE token_hash = ?`,
          )
          .bind(keyHash)
          .first<{
            id: string
            workspace_id: string
            permission: string
            revoked_at: string | null
            expires_at: string | null
          }>()
        if (!row || row.revoked_at) return null
        if (row.expires_at && Date.parse(row.expires_at) < Date.now()) return null
        return {
          workspaceId: row.workspace_id,
          permission: row.permission as AuthContext['permission'],
          apiKeyId: row.id,
        }
      },
    },
    // Server-side only. An agent that could compute this signature could mint
    // its own confirmation, which is the whole thing this gate prevents.
    confirmationSecret: env.MS_SECRET,
    approvals: new SqlApprovals(sql),
    consumed: new SqlConsumedTokens(sql),
  })

  return mcpHttpHandler(server, { realm: 'MailySend' })(request)
}

// ---------------------------------------------------------------------------
// The backend, over our own API
// ---------------------------------------------------------------------------

/**
 * Calls `/v1` as the caller.
 *
 * The bearer token is the one that arrived on the MCP request, so the API's own
 * authentication resolves the same actor a second time. That looks redundant
 * next to the `AuthPort` above — but the `AuthPort` exists to answer "may this
 * client speak MCP at all", while this answers "may this actor perform this
 * operation", and collapsing the two would mean the tool layer deciding scopes,
 * which is exactly where an authorization bug would hide.
 */
function restBackend(request: Request, token: string): McpBackend {
  const origin = new URL(request.url).origin

  async function call<T>(
    method: string,
    path: string,
    init: { body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` }
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    if (init.idempotencyKey) headers['idempotency-key'] = init.idempotencyKey

    const response = await api.fetch(
      new Request(`${origin}/v1${path}`, {
        method,
        headers,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
      getEnv(),
    )
    const text = await response.text()
    const parsed: unknown = text ? JSON.parse(text) : null
    if (!response.ok) {
      // The API's error body is already the shape the MCP layer turns into a
      // JSON-RPC error, so it is passed through rather than re-described.
      const body = parsed as { message?: string; name?: string } | null
      throw new Error(body?.message ?? body?.name ?? `request failed with ${response.status}`)
    }
    return parsed as T
  }

  const query = (params: Record<string, string | number | undefined>): string => {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') search.set(key, String(value))
    }
    const rendered = search.toString()
    return rendered ? `?${rendered}` : ''
  }

  return {
    async listEmails(_ctx: AuthContext, input: EmailListInput): Promise<EmailListResult> {
      return call<EmailListResult>(
        'GET',
        `/emails${query({ limit: input.limit, after: input.after, before: input.before, status: input.status })}`,
      )
    },

    async getEmail(_ctx: AuthContext, emailId: string): Promise<Email | null> {
      try {
        return await call<Email>('GET', `/emails/${encodeURIComponent(emailId)}`)
      } catch {
        return null
      }
    },

    async sendEmail(
      _ctx: AuthContext,
      payload: SendPayload,
      options: SendOptions,
    ): Promise<SentEmail> {
      return call<SentEmail>('POST', '/emails', {
        body: payload,
        idempotencyKey: options.idempotencyKey,
      })
    },

    async searchThreads(
      _ctx: AuthContext,
      input: { query: string; limit: number },
    ): Promise<ThreadHit[]> {
      const result = await call<{
        data: {
          id: string
          thread_id: string
          subject: string
          snippet: string
          from: string
          received_at: string
        }[]
      }>('GET', `/inbound/search${query({ q: input.query, limit: input.limit })}`)
      return result.data.map((hit) => ({
        thread_id: hit.thread_id,
        message_id: hit.id,
        subject: hit.subject,
        snippet: hit.snippet,
        from: hit.from,
        received_at: hit.received_at,
      }))
    },

    async getThread(_ctx: AuthContext, threadId: string): Promise<ThreadDetail | null> {
      try {
        const thread = await call<{
          id: string
          subject: string
          participants: string[]
          message_count: number
          unread: boolean
          last_message_at: string
          messages: ThreadDetail['messages']
        }>('GET', `/inbound/threads/${encodeURIComponent(threadId)}`)
        return {
          thread: {
            id: thread.id,
            subject: thread.subject,
            participants: thread.participants,
            message_count: thread.message_count,
            unread: thread.unread,
            last_message_at: thread.last_message_at,
          },
          messages: thread.messages,
        }
      } catch {
        return null
      }
    },

    async replyToThread(
      _ctx: AuthContext,
      payload: ReplyPayload,
      options: SendOptions,
    ): Promise<RepliedMessage> {
      const { thread_id: threadId, ...body } = payload
      const replied = await call<{ id: string; thread_id: string }>(
        'POST',
        `/inbound/threads/${encodeURIComponent(threadId)}/reply`,
        { body, idempotencyKey: options.idempotencyKey },
      )
      return { id: replied.id, thread_id: replied.thread_id }
    },

    async listDomains(): Promise<Domain[]> {
      const result = await call<{ data: Domain[] }>('GET', '/domains')
      return result.data
    },

    async getAnalytics(_ctx: AuthContext, input: StatsInput): Promise<AnalyticsSummary> {
      const overview = await call<AnalyticsOverview>(
        'GET',
        `/analytics/overview${query({
          from: input.from,
          to: input.to,
          domain_id: input.domain_id,
          tag: input.tag,
          provider: input.provider,
          audience_class: input.audience_class,
        })}`,
      )
      return {
        range: { from: overview.from, to: overview.to, granularity: input.granularity ?? 'day' },
        audience_class: input.audience_class ?? 'human',
        totals: {
          sent: overview.sent,
          delivered: overview.delivered,
          opened: overview.opened,
          clicked: overview.clicked,
          bounced: overview.bounced,
          complained: overview.complained,
          unsubscribed: overview.unsubscribed,
          failed: overview.failed,
        },
        rates: {
          delivery_rate: overview.rates.delivery,
          open_rate: overview.rates.open,
          click_rate: overview.rates.click,
          bounce_rate: overview.rates.bounce,
          complaint_rate: overview.rates.complaint,
        },
      }
    },

    async createContact(
      _ctx: AuthContext,
      payload: { email: string; audience_id?: string } & Record<string, unknown>,
    ): Promise<Contact> {
      return call<Contact>('POST', '/contacts', { body: payload })
    },
  }
}

interface AnalyticsOverview {
  from: string
  to: string
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  complained: number
  unsubscribed: number
  failed: number
  rates: {
    delivery: number
    open: number
    click: number
    bounce: number
    complaint: number
  }
}

// ---------------------------------------------------------------------------
// Confirmations
// ---------------------------------------------------------------------------

/**
 * Confirmations live in SQL, not KV.
 *
 * The dashboard has to be able to ask "what is this workspace waiting on?", and
 * a key-value store cannot answer that without a scan. The rows are small, they
 * expire in minutes, and the table is swept by the nightly maintenance cron.
 */
class SqlApprovals implements ConfirmationApprovals {
  constructor(private readonly sql: Sql) {}

  async mint(pending: PendingConfirmation): Promise<void> {
    await this.sql
      .prepare(
        `INSERT INTO mcp_confirmations
           (token, workspace_id, tool, summary, status, created_at, expires_at)
         VALUES (?,?,?,?, 'pending', ?, ?)
         ON CONFLICT (token) DO NOTHING`,
      )
      .bind(
        pending.token,
        pending.workspaceId,
        pending.tool,
        JSON.stringify(pending.summary),
        pending.createdAt,
        pending.expiresAt,
      )
      .run()
  }

  async get(token: string): Promise<PendingConfirmation | null> {
    const row = await this.sql
      .prepare(
        `SELECT token, workspace_id, tool, summary, created_at, expires_at
           FROM mcp_confirmations WHERE token = ?`,
      )
      .bind(token)
      .first<ConfirmationRow>()
    return row ? toPending(row) : null
  }

  async isApproved(token: string): Promise<boolean> {
    const row = await this.sql
      .prepare(`SELECT status FROM mcp_confirmations WHERE token = ?`)
      .bind(token)
      .first<{ status: string }>()
    return row?.status === 'approved'
  }

  async approve(token: string, approvedBy: string): Promise<boolean> {
    return this.decide(token, 'approved', approvedBy)
  }

  async reject(token: string, rejectedBy: string): Promise<boolean> {
    return this.decide(token, 'rejected', rejectedBy)
  }

  /**
   * A decision only lands on a token that is still pending, so a race between
   * two approvers — or an approve arriving after a reject — resolves to
   * whichever came first rather than to whichever wrote last.
   */
  private async decide(token: string, status: string, by: string): Promise<boolean> {
    const result = await this.sql
      .prepare(
        `UPDATE mcp_confirmations SET status = ?, decided_by = ?
          WHERE token = ? AND status = 'pending' AND expires_at > ?`,
      )
      .bind(status, by, token, Date.now())
      .run()
    return result.meta.changes > 0
  }

  async pending(workspaceId: string): Promise<PendingConfirmation[]> {
    const rows = await this.sql
      .prepare(
        `SELECT token, workspace_id, tool, summary, created_at, expires_at
           FROM mcp_confirmations
          WHERE workspace_id = ? AND status = 'pending' AND expires_at > ?
          ORDER BY created_at DESC LIMIT 100`,
      )
      .bind(workspaceId, Date.now())
      .all<ConfirmationRow>()
    return rows.results.map(toPending)
  }
}

/** One approval, one message: `consumed_at` is claimed by a conditional update. */
class SqlConsumedTokens implements ConsumedTokens {
  constructor(private readonly sql: Sql) {}

  async consume(token: string, _expiresAt: number): Promise<boolean> {
    const result = await this.sql
      .prepare(
        `UPDATE mcp_confirmations SET consumed_at = ?
          WHERE token = ? AND status = 'approved' AND consumed_at IS NULL`,
      )
      .bind(new Date().toISOString(), token)
      .run()
    return result.meta.changes > 0
  }
}

interface ConfirmationRow {
  token: string
  workspace_id: string
  tool: string
  summary: string
  created_at: number
  expires_at: number
}

const toPending = (row: ConfirmationRow): PendingConfirmation => ({
  token: row.token,
  tool: row.tool as PendingConfirmation['tool'],
  workspaceId: row.workspace_id,
  summary: JSON.parse(row.summary) as PendingConfirmation['summary'],
  createdAt: row.created_at,
  expiresAt: row.expires_at,
})

export { hashApiKey, SqlApprovals }
