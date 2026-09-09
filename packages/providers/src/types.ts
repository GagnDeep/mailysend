import type { ParsedAddress } from '@mailysend/core'

/**
 * The provider abstraction.
 *
 * This is the first thing written and the most defended boundary in the repo,
 * because Cloudflare Email Service is in beta. If the abstraction leaks, a
 * change on Cloudflare's side becomes a rewrite; if it holds, it becomes a
 * config change. The way we keep it honest is by writing the SES adapter
 * immediately after the Cloudflare one — a single implementation always looks
 * like a clean abstraction, and never is.
 *
 * Nothing Cloudflare-specific may appear above this file.
 */

export type ProviderName = 'cloudflare' | 'ses' | 'resend' | 'smtp'

export interface OutboundMessage {
  /** Our id, minted before any provider is called. Stamped into Message-ID. */
  emailId: string
  workspaceId: string
  from: ParsedAddress
  to: ParsedAddress[]
  cc?: ParsedAddress[]
  bcc?: ParsedAddress[]
  replyTo?: ParsedAddress[]
  subject: string
  html?: string
  text?: string
  headers?: Record<string, string>
  attachments?: OutboundAttachment[]
  /** `cf-bounce.<domain>` or the SES/SMTP equivalent. Where DSNs are collected. */
  returnPath?: string
  dkim?: { domain: string; selector: string; privateKey: string }
}

export interface OutboundAttachment {
  filename: string
  contentType: string
  /** Raw bytes. Base64 encoding happens inside the adapter that needs it. */
  content: Uint8Array
  /** Set for inline images referenced as `cid:` in the HTML. */
  contentId?: string
}

export interface SendResult {
  /** The provider's own id. Recorded for DSN correlation; never our identity. */
  providerMessageId: string | null
  provider: ProviderName
  /** Verbatim, when the provider gives us one. Shown in the log drawer. */
  smtpResponse?: string
  acceptedAt: string
}

/**
 * Errors are classified, not just thrown, because the classification decides
 * whether we retry, fail over, or stop — and getting that wrong either loses
 * mail or sends it twice.
 */
export type SendErrorKind =
  /** The message will never be accepted as written. Do not retry, do not fail over. */
  | 'permanent'
  /** Transient on this provider. Retry here first, fail over if it persists. */
  | 'transient'
  /** We are over quota. Retry after the indicated delay; failover is reasonable. */
  | 'throttled'
  /** Credentials or configuration. A retry cannot help; alert instead. */
  | 'auth'
  /** The provider suppressed the recipient itself. Mirror it inward. */
  | 'suppressed'
  /**
   * We never learned whether the provider accepted it. This is the one case
   * that must NOT fail over: the message may already be on the wire, and
   * sending it again through a second provider would deliver it twice.
   */
  | 'unknown'

export class SendError extends Error {
  readonly kind: SendErrorKind
  readonly provider: ProviderName
  readonly retryAfterSeconds?: number
  readonly providerCode?: string
  readonly smtpResponse?: string

  constructor(
    kind: SendErrorKind,
    provider: ProviderName,
    message: string,
    opts: { retryAfterSeconds?: number; providerCode?: string; smtpResponse?: string } = {},
  ) {
    super(message)
    this.name = 'SendError'
    this.kind = kind
    this.provider = provider
    this.retryAfterSeconds = opts.retryAfterSeconds
    this.providerCode = opts.providerCode
    this.smtpResponse = opts.smtpResponse
  }

  /** Only these may be retried on a *different* provider. */
  get canFailover(): boolean {
    return this.kind === 'transient' || this.kind === 'throttled'
  }
}

export interface ProviderLimits {
  /** Total recipients across to+cc+bcc in one message. */
  maxRecipients: number
  /** Total rendered message size, bytes. */
  maxMessageBytes: number
  maxAttachmentBytes: number
  maxSubjectChars: number
  maxHeaderBytes: number
  /** Null when the provider does not publish one. */
  dailyQuota: number | null
}

export interface Provider {
  readonly name: ProviderName
  readonly limits: ProviderLimits
  /**
   * Whether this provider reports delivery events back to us. Cloudflare does
   * via Queues subscriptions; SES via SNS; Resend via webhooks; raw SMTP does
   * not, which is why SMTP sends fall back to DSN parsing and say so.
   */
  readonly reportsEvents: boolean
  send(message: OutboundMessage): Promise<SendResult>
  /** DNS records this provider needs for a sending domain. */
  dnsRecords(
    domain: string,
    opts: { selector: string; returnPath: string; dkimPublicKey?: string },
  ): DnsRequirement[]
  /** Cheap liveness check for the dashboard's provider panel. */
  verify?(): Promise<{ ok: boolean; detail?: string }>
}

export interface DnsRequirement {
  record: 'TXT' | 'MX' | 'CNAME'
  name: string
  value: string
  priority?: number
  purpose: string
}
