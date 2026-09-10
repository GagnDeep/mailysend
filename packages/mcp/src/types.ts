import type {
  ApiKeyPermission,
  Contact,
  Domain,
  Email as EmailSchema,
  InboundMessage,
  SendEmailRequest,
  StatsQuery,
} from '@mailysend/contracts'
import type { z } from 'zod'

/**
 * The ports.
 *
 * This package contains the MCP protocol and the confirmation gate and nothing
 * else — no database, no Durable Object, no fetch. Everything that touches the
 * product arrives through the interfaces below, which is what lets the whole
 * server be tested against fakes and lets `apps/app` wire the real thing
 * without this package depending on the runtime it happens to be on.
 */

export type Email = z.infer<typeof EmailSchema>
export type Permission = z.infer<typeof ApiKeyPermission>
export type StatsInput = z.input<typeof StatsQuery>
export type SendPayload = z.infer<typeof SendEmailRequest>

/** Who the caller is, resolved once per request from the bearer token. */
export interface AuthContext {
  workspaceId: string
  permission: Permission
  apiKeyId?: string
  /** `test` keys are answered from the same code path; the backend segregates. */
  mode: 'live' | 'test'
}

export interface AuthPort {
  /**
   * Takes the SHA-256 of the presented token, never the token itself. The MCP
   * server therefore never holds a credential it could log.
   */
  resolve(keyHash: string): Promise<Omit<AuthContext, 'mode'> | null>
}

export interface EmailListInput {
  limit: number
  after?: string
  before?: string
  status?: string
}

export interface EmailListResult {
  data: Email[]
  has_more: boolean
  next_cursor?: string | null
}

export interface ThreadHit {
  thread_id: string
  message_id: string
  subject: string
  snippet: string
  from: string
  received_at: string
}

export interface ThreadDetail {
  thread: {
    id: string
    subject: string
    participants: string[]
    message_count: number
    unread: boolean
    last_message_at: string
  }
  messages: InboundMessage[]
}

export interface ReplyPayload {
  thread_id: string
  from?: string
  subject?: string
  text?: string
  html?: string
  cc?: string[]
  bcc?: string[]
}

export interface AnalyticsTotals {
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  complained: number
  unsubscribed: number
  failed: number
}

export interface AnalyticsSummary {
  range: { from: string; to: string; granularity: string }
  audience_class: string
  totals: AnalyticsTotals
  rates: {
    delivery_rate: number
    open_rate: number
    click_rate: number
    bounce_rate: number
    complaint_rate: number
  }
  series?: ({ at: string } & Partial<AnalyticsTotals>)[]
}

export interface SendOptions {
  /**
   * Derived from the confirmation token's nonce, so a network-level retry of an
   * approved call collapses onto one message rather than two.
   */
  idempotencyKey: string
}

export interface SentEmail {
  id: string
  created_at?: string
}

export interface RepliedMessage {
  id: string
  thread_id: string
}

export interface McpBackend {
  listEmails(ctx: AuthContext, input: EmailListInput): Promise<EmailListResult>
  getEmail(ctx: AuthContext, emailId: string): Promise<Email | null>
  sendEmail(ctx: AuthContext, payload: SendPayload, options: SendOptions): Promise<SentEmail>
  /** Backed by `MailboxActor`'s contentless FTS5 `search` table — one hop, no scan. */
  searchThreads(ctx: AuthContext, input: { query: string; limit: number }): Promise<ThreadHit[]>
  /** Backed by `MailboxActor.getThread`; bodies come from object storage. */
  getThread(ctx: AuthContext, threadId: string): Promise<ThreadDetail | null>
  replyToThread(
    ctx: AuthContext,
    payload: ReplyPayload,
    options: SendOptions,
  ): Promise<RepliedMessage>
  listDomains(ctx: AuthContext): Promise<Domain[]>
  getAnalytics(ctx: AuthContext, query: StatsInput): Promise<AnalyticsSummary>
  createContact(
    ctx: AuthContext,
    payload: { email: string; audience_id?: string } & Record<string, unknown>,
  ): Promise<Contact>
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

export type SendingToolName = 'send_email' | 'reply_to_thread'

/** What a human is shown before they approve. Never derived at approval time. */
export interface ConfirmationSummary {
  tool: SendingToolName
  from: string | null
  to: string[]
  cc: string[]
  bcc: string[]
  reply_to: string[]
  subject: string
  preview: string
  attachment_count: number
  tag_count: number
  scheduled_at: string | null
  template_id: string | null
  thread_id: string | null
}

export interface PendingConfirmation {
  token: string
  tool: SendingToolName
  workspaceId: string
  summary: ConfirmationSummary
  createdAt: number
  expiresAt: number
}

/**
 * The human-in-the-loop seam.
 *
 * `mint` records a confirmation that is *not yet spendable*. Only `approve`
 * makes it spendable, and `approve` is called by the dashboard or the CLI on
 * behalf of a signed-in person — it is deliberately absent from the JSON-RPC
 * method table and from the tool list, so no sequence of MCP calls can reach
 * it. That absence, not a sentence in a description, is what stops an agent
 * approving its own send.
 */
export interface ConfirmationApprovals {
  mint(pending: PendingConfirmation): Promise<void>
  get(token: string): Promise<PendingConfirmation | null>
  isApproved(token: string): Promise<boolean>
  approve(token: string, approvedBy: string): Promise<boolean>
  reject(token: string, rejectedBy: string): Promise<boolean>
  pending(workspaceId: string): Promise<PendingConfirmation[]>
}

export interface ConsumedTokens {
  /** False when the token has already been spent. Must be atomic per token. */
  consume(token: string, expiresAt: number): Promise<boolean>
}

export interface McpServerOptions {
  backend: McpBackend
  auth: AuthPort
  /**
   * Signing key for confirmation tokens. Server-side only: an agent that could
   * compute this signature could mint its own confirmation, so it never travels
   * in a tool result, an error message or a log line.
   */
  confirmationSecret: string
  approvals?: ConfirmationApprovals
  consumed?: ConsumedTokens
  /** Short by design: a stale approval is an approval for a forgotten message. */
  confirmationTtlSeconds?: number
  /**
   * Where a person goes to approve a pending confirmation.
   *
   * Hardcoded to `https://mailysend.com/app/approvals` until now, which is a
   * 404 on the hosted site and the wrong host on every self-hosted instance —
   * so the one instruction an agent hands back to its user pointed nowhere.
   * The server derives it from the request origin when this is unset.
   */
  approvalChannel?: string
  serverInfo?: { name: string; version: string }
  instructions?: string
  now?: () => number
}
