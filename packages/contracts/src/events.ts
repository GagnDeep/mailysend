import { z } from 'zod'
import { EmailId, IsoDate, Tag } from './primitives.ts'

/**
 * The normalized event.
 *
 * Cloudflare Queues subscriptions, SES/SNS notifications, Resend webhooks and
 * SMTP DSNs all land here. Downstream — D1, Analytics Engine, R2 staging,
 * webhook fan-out — only ever sees this shape.
 */

/**
 * The state ladder. Every D1 status update is `WHERE state_rank < ?`, which
 * makes out-of-order and duplicate events no-ops rather than corruption. That
 * single property is why the pipeline needs no ordering guarantee at all.
 *
 * Terminal negative states outrank the positive ladder: once a message is a
 * hard bounce, a late `delivered` must not overwrite it.
 */
export const STATE_RANK = {
  queued: 10,
  scheduled: 15,
  sending: 20,
  sent: 30,
  delivery_delayed: 35,
  delivered: 40,
  opened: 50,
  clicked: 60,
  canceled: 80,
  complained: 90,
  bounced: 95,
  failed: 96,
} as const
export type StateName = keyof typeof STATE_RANK

export const NormalizedEventType = z.enum([
  'sent',
  'delivered',
  'delivery_delayed',
  'bounced',
  'complained',
  'failed',
  'rejected',
  'opened',
  'clicked',
  'unsubscribed',
])
export type NormalizedEventType = z.infer<typeof NormalizedEventType>

/**
 * Open and click hits are classified at the edge before anything is written.
 * Nothing is discarded — every hit is stored with its class, charts default to
 * `human`, and "privacy-adjusted open rate" excludes `mpp` and says so.
 */
export const AudienceClass = z.enum([
  /** A real person. */
  'human',
  /** Apple Mail Privacy Protection / iCloud Private Relay pre-fetch. */
  'mpp',
  /** Gmail's image proxy warming the pixel within ~2s of delivery. */
  'proxy_prefetch',
  /** Link/attachment security scanners: ≥3 links in 2s, HEAD requests, known vendors. */
  'scanner',
  /** Everything else the UA ruleset flags. */
  'bot',
])
export type AudienceClass = z.infer<typeof AudienceClass>

export const BounceClass = z.enum([
  'hard_invalid',
  'hard_domain',
  'hard_blocked',
  'soft_mailbox_full',
  'soft_throttled',
  'soft_temporary',
  'soft_content',
  'unknown',
])

export const NormalizedEvent = z.object({
  /**
   * `sha256(provider|provider_message_id|type|recipient|unix_second)`.
   * Deterministic, so a redelivered provider webhook produces a byte-identical
   * id and dedupes on write instead of needing a transaction.
   */
  event_id: z.string().length(64),
  workspace_id: z.string(),
  email_id: EmailId.nullable(),
  type: NormalizedEventType,
  recipient: z.string(),
  occurred_at: IsoDate,
  provider: z.enum(['cloudflare', 'ses', 'resend', 'smtp', 'internal']),
  provider_message_id: z.string().nullable(),

  /** Verbatim SMTP response, when the provider gives one. Shown in the log drawer. */
  smtp_response: z.string().nullable().optional(),
  smtp_code: z.string().max(8).nullable().optional(),
  bounce_class: BounceClass.optional(),
  diagnostic: z.string().max(2000).nullable().optional(),

  /** Present on opened/clicked only. */
  audience_class: AudienceClass.optional(),
  link_url: z.string().max(2048).optional(),
  ip: z.string().max(45).optional(),
  user_agent: z.string().max(512).optional(),
  geo_country: z.string().length(2).optional(),

  tags: z.array(Tag).optional(),
  broadcast_id: z.string().nullable().optional(),
  automation_id: z.string().nullable().optional(),
  contact_id: z.string().nullable().optional(),
})
export type NormalizedEvent = z.infer<typeof NormalizedEvent>

/** The body POSTed to customer webhook endpoints. Resend's shape, supersetted. */
export const WebhookPayload = z.object({
  type: z.string(),
  created_at: IsoDate,
  data: z.record(z.string(), z.unknown()),
})

/**
 * `MailySend-Signature: t=<unix>,v1=<hex hmac>` over `${t}.${rawBody}`.
 * The timestamp is inside the signed payload, so a captured delivery cannot be
 * replayed outside the tolerance window.
 */
export const SIGNATURE_HEADER = 'mailysend-signature'
export const SIGNATURE_TOLERANCE_SECONDS = 300
