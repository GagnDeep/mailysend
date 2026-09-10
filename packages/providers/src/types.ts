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
  /**
   * Cheap liveness check for the dashboard's provider panel.
   *
   * Three answers, not two. `unknown` is the honest one for a transport whose
   * only evidence is that a binding exists — Cloudflare's `send_email` binding
   * is present on every Worker that declares it, configured or not, so
   * reporting `ok` from its presence told an operator their Email Service was
   * ready when the first send would fail. A check that cannot fail is not a
   * check, and a preflight that always passes is worse than none.
   */
  verify?(): Promise<{ status: 'ok' | 'unknown' | 'failed'; detail?: string }>
  /**
   * Creating the sending identity, where the provider will do it for us.
   *
   * Ask the provider; do not invent. `dnsRecords` is what *we* would compute
   * from first principles, and for two of the four transports it is wrong:
   * Cloudflare writes its own records when a domain is onboarded in its
   * dashboard, and Resend issues its own DKIM key. A transport that implements
   * this returns the records *it* says it needs — possibly none at all, with an
   * `external` hand-off into its own flow instead.
   */
  identity?: ProviderIdentity
}

export interface ProviderIdentity {
  /**
   * Registers the domain with the provider and reports what it wants published.
   *
   * `records: []` with an `external` link is a legitimate answer: it means the
   * provider publishes them itself and the customer has nothing to copy.
   */
  ensure(
    domain: string,
    opts: { selector: string; returnPath: string; dkimPublicKey?: string; dkimPrivateKey?: string },
  ): Promise<IdentityState>
  /** Where the provider thinks the domain has got to, asked fresh. */
  status(domain: string): Promise<IdentityState>
}

export interface IdentityState {
  status: 'verified' | 'pending' | 'failed' | 'unknown'
  /** What the provider says must be published. Empty means it does that itself. */
  records: DnsRequirement[]
  detail?: string
  /**
   * A hand-off into the provider's own flow, where that flow is better than
   * ours. Cloudflare's onboarding writes every record automatically; sending a
   * customer there is more honest than printing a list they must not use.
   */
  external?: { url: string; label: string }
}

export interface DnsRequirement {
  record: 'TXT' | 'MX' | 'CNAME'
  name: string
  value: string
  priority?: number
  purpose: string
  /**
   * Who publishes it. `copy` is the customer's job; `observe` is a record the
   * transport writes itself and we only look for. Defaults to `copy`.
   */
  origin?: 'copy' | 'observe'
  /**
   * How a resolved value is compared. `exact` by default; `include` for SPF,
   * where merging our include into an existing record is correct; `prefix` for
   * a value only the provider knows, such as a DKIM key it mints, where the
   * most that can be checked is that something of the right shape is there.
   */
  match?: 'exact' | 'include' | 'prefix'
}
