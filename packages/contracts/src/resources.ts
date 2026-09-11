import { z } from 'zod'
import {
  ApiKeyId,
  AudienceId,
  AutomationId,
  BroadcastId,
  ContactId,
  DomainId,
  emailAddress,
  IsoDate,
  SegmentId,
  TemplateId,
  ThreadId,
  WebhookId,
} from './primitives.ts'

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

/** Where MailySend's own infrastructure lives for a customer sending domain. */
export const DnsRecord = z.object({
  record: z.enum(['TXT', 'MX', 'CNAME']),
  name: z.string(),
  value: z.string(),
  type: z.string(),
  ttl: z.string().default('Auto'),
  priority: z.number().int().optional(),
  /**
   * `error` means the lookup did not happen — the resolver was unreachable, or
   * the zone's nameservers failed to answer. It is not `failed`, which is the
   * actionable case of a record that exists and disagrees, and it is emphatically
   * not `verified`: returning the previous status on a resolver exception is how
   * a domain whose every record errored still reported itself verified.
   */
  status: z.enum(['not_started', 'pending', 'verified', 'failed', 'error']),
  /** Which transport needs this record. The union is rendered per provider. */
  provider: z.enum(['cloudflare', 'ses', 'resend', 'smtp', 'all']).default('all'),
  /** Human explanation shown under the row — the design's setup screen shows one per record. */
  purpose: z.string().optional(),
  /**
   * Who publishes it. `observe` is a record the transport writes itself —
   * Cloudflare's onboarding adds every one of its records — so it is checked
   * but never offered for copying.
   */
  origin: z.enum(['copy', 'observe']).default('copy'),
  /** How the resolved value is compared. */
  match: z.enum(['exact', 'include', 'prefix']).default('exact'),
  /** What actually resolved, so a failed row can show the difference. */
  found: z.string().nullable().optional(),
  /** Why the lookup could not be made, when `status` is `error`. */
  error: z.string().nullable().optional(),
  /** The value we asked for, so the row can show found against expected. */
  expected: z.string().nullable().optional(),
  /** When the resolver last looked. Null means never checked, not "failed". */
  last_checked_at: IsoDate.nullable().optional(),
})

export const DomainStatus = z.enum([
  'not_started',
  'pending',
  'verified',
  'failed',
  'temporary_failure',
])

export const Domain = z.object({
  object: z.literal('domain'),
  id: DomainId,
  name: z.string(),
  status: DomainStatus,
  created_at: IsoDate,
  region: z.string().default('global'),
  records: z.array(DnsRecord).optional(),
  /** Whether outgoing mail is signed and aligned. Drives the deliverability banner. */
  dkim_ready: z.boolean().optional(),
  spf_ready: z.boolean().optional(),
  /**
   * Null until DMARC has been read for this domain — which is a different
   * statement from `missing`, the answer that a record was looked for and was
   * not there.
   */
  dmarc_policy: z.enum(['none', 'quarantine', 'reject', 'missing']).nullable().optional(),
  /** Learned by SendingDomainDO from provider rejections; null before the first send. */
  daily_quota: z.number().int().nullable().optional(),
  /**
   * Off unless somebody turned them on.
   *
   * Both alter the message in a way the recipient can see — a pixel their
   * client fetches from us, and links that point at our redirector — and
   * neither is required to send. The schema default has to match the column
   * default, or a client parsing a partial row invents a setting the server
   * does not hold.
   */
  open_tracking: z.boolean().default(false),
  click_tracking: z.boolean().default(false),
  custom_return_path: z.string().default('cf-bounce'),
  /** The DKIM selector the DNS records were minted for; `ms1` unless overridden. */
  dkim_selector: z.string().optional(),
  /** Outbound TLS policy. `enforced` fails a send rather than downgrading. */
  tls: z.enum(['opportunistic', 'enforced']).optional(),
  /** Null until the first successful verification, then the last one that passed. */
  last_verified_at: IsoDate.nullable().optional(),
  /** The transport the records were derived from. Null = the workspace default. */
  provider: z.enum(['cloudflare', 'ses', 'resend', 'smtp']).nullable().optional(),
  /**
   * Can this domain send: verified *and* DKIM and SPF actually resolving.
   *
   * Narrower than `status` on purpose — a roll-up can read `verified` for a
   * record set that predates a transport rebind.
   */
  sending_ready: z.boolean().optional(),
  /**
   * Everything the server honestly knows about receiving.
   *
   * There is deliberately no `ready` here. Cloudflare's Email Routing catch-all
   * rule is not readable over its API, so the server can prove the MX points at
   * Email Routing and that mailboxes exist, and cannot prove mail arrives — a
   * boolean would be a claim nothing supports. The gap is named instead, and
   * `last_inbound_at` is the only end-to-end proof that exists.
   */
  receiving: z
    .object({
      /** Null means nobody has run a receiving check yet, not that one failed. */
      mx_status: z.enum(['pending', 'verified', 'failed', 'error']).nullable(),
      mx_found: z.string().nullable(),
      expected: z.string(),
      checked_at: IsoDate.nullable(),
      mailboxes: z.object({
        count: z.number().int(),
        catch_all: z.string().nullable(),
      }),
      catch_all: z.object({
        observable: z.literal(false),
        detail: z.string(),
      }),
      last_inbound_at: IsoDate.nullable(),
    })
    .optional(),
  /**
   * The most recent permanent send failure for this domain, if there is one.
   *
   * Surfaced here because the setting that fixes it is on this page — a domain
   * bound to a transport the workspace has not configured fails every send, and
   * says so nowhere a person would look.
   */
  last_send_error: z
    .object({
      email_id: z.string(),
      provider: z.string().nullable(),
      error: z.string(),
      at: IsoDate,
    })
    .nullable()
    .optional(),
  /**
   * How much of the last check actually happened — on a verify response, and on
   * a GET, where it is derived from the stored rows. Without it a check that
   * could reach the resolver for two of six records was indistinguishable from
   * one that checked all six and found four missing — the same `pending`, and
   * no reason to suspect the network.
   */
  checked: z
    .object({
      total: z.number().int(),
      resolved: z.number().int(),
      errored: z.number().int(),
      first_error: z.string().nullable().optional(),
    })
    .optional(),
  /** What the transport itself says, where it has an identity API to ask. */
  identity: z
    .object({
      status: z.string(),
      detail: z.string().nullable().optional(),
      external: z.object({ url: z.string(), label: z.string() }).nullable().optional(),
    })
    .optional(),
})

export const CreateDomainRequest = z.object({
  name: z
    .string()
    .min(3)
    .max(253)
    .regex(
      /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i,
      'must be a bare domain, e.g. example.com',
    ),
  region: z.string().optional(),
  custom_return_path: z.string().max(63).optional(),
})

export const UpdateDomainRequest = z.object({
  open_tracking: z.boolean().optional(),
  click_tracking: z.boolean().optional(),
  tls: z.enum(['opportunistic', 'enforced']).optional(),
})

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export const ApiKeyPermission = z.enum(['full_access', 'sending_access'])

export const CreateApiKeyRequest = z.object({
  name: z.string().min(1).max(80),
  permission: ApiKeyPermission.default('full_access'),
  /** Scope a sending key to one domain. */
  domain_id: DomainId.optional(),
  /** Keys that expire are the difference between a leak and an incident. */
  expires_at: IsoDate.optional(),
})

export const ApiKey = z.object({
  object: z.literal('api_key'),
  id: ApiKeyId,
  name: z.string(),
  created_at: IsoDate,
  permission: ApiKeyPermission.optional(),
  /** `ms_live_a1b2…` — first 12 chars only. The secret is shown exactly once. */
  token_preview: z.string().optional(),
  last_used_at: IsoDate.nullable().optional(),
  expires_at: IsoDate.nullable().optional(),
})

export const CreatedApiKey = z.object({
  object: z.literal('api_key'),
  id: ApiKeyId,
  /** Present only in the create response. Never retrievable again. */
  token: z.string(),
})

// ---------------------------------------------------------------------------
// Audiences & contacts
// ---------------------------------------------------------------------------

export const Audience = z.object({
  object: z.literal('audience'),
  id: AudienceId,
  name: z.string(),
  created_at: IsoDate,
  contact_count: z.number().int().optional(),
})

export const CreateAudienceRequest = z.object({ name: z.string().min(1).max(120) })

export const Contact = z.object({
  object: z.literal('contact'),
  id: ContactId,
  email: z.string(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  created_at: IsoDate,
  unsubscribed: z.boolean(),
  audience_id: AudienceId.optional(),
  /** Arbitrary merge data. Keys used in a segment get an expression index on second use. */
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  // Denormalised engagement, maintained by the event consumer so segment
  // predicates like `last_open < 30d` are an indexed comparison, not a join.
  last_open_at: IsoDate.nullable().optional(),
  last_click_at: IsoDate.nullable().optional(),
  open_count: z.number().int().optional(),
  click_count: z.number().int().optional(),
})

export const CreateContactRequest = z.object({
  email: emailAddress,
  first_name: z.string().max(120).optional(),
  last_name: z.string().max(120).optional(),
  unsubscribed: z.boolean().optional(),
  audience_id: AudienceId.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
})

export const UpdateContactRequest = CreateContactRequest.partial().omit({ audience_id: true })

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export const Segment = z.object({
  object: z.literal('segment'),
  id: SegmentId,
  name: z.string(),
  audience_id: AudienceId,
  /** The DSL source, e.g. `opened_last_30d and not clicked_last_30d`. */
  expression: z.string(),
  created_at: IsoDate,
  updated_at: IsoDate,
  member_count: z.number().int().optional(),
  /** Segments are recomputed by delta; this is the last full or delta pass. */
  computed_at: IsoDate.nullable().optional(),
})

export const CreateSegmentRequest = z.object({
  name: z.string().min(1).max(120),
  audience_id: AudienceId,
  expression: z.string().min(1).max(4000),
})

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const TemplateEngine = z.enum(['handlebars', 'mjml', 'jsx-ast', 'html'])

export const Template = z.object({
  object: z.literal('template'),
  id: TemplateId,
  name: z.string(),
  slug: z.string(),
  engine: TemplateEngine,
  subject: z.string().nullable(),
  version: z.number().int(),
  created_at: IsoDate,
  updated_at: IsoDate,
  /** Variables discovered by compiling the body. Powers the preview form. */
  variables: z.array(z.string()).optional(),
})

export const CreateTemplateRequest = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  engine: TemplateEngine.default('handlebars'),
  subject: z.string().max(998).optional(),
  html: z.string().max(2_000_000).optional(),
  text: z.string().max(2_000_000).optional(),
  /** Data-only AST produced by `mailysend templates push` from JSX. */
  ast: z.unknown().optional(),
})

// ---------------------------------------------------------------------------
// Broadcasts
// ---------------------------------------------------------------------------

export const BroadcastStatus = z.enum([
  'draft',
  'scheduled',
  'sending',
  'paused',
  'sent',
  'canceled',
])

export const BroadcastVariant = z.object({
  key: z.string().max(8),
  subject: z.string().max(998),
  html: z.string().optional(),
  text: z.string().optional(),
  /** Percentage of the test cohort. Must sum to 100 across variants. */
  weight: z.number().int().min(1).max(100),
})

export const Broadcast = z.object({
  object: z.literal('broadcast'),
  id: BroadcastId,
  name: z.string().nullable(),
  audience_id: AudienceId.nullable(),
  segment_id: SegmentId.nullable().optional(),
  from: z.string().nullable(),
  subject: z.string().nullable(),
  reply_to: z.array(z.string()).nullable(),
  preview_text: z.string().nullable().optional(),
  status: BroadcastStatus,
  created_at: IsoDate,
  scheduled_at: IsoDate.nullable(),
  sent_at: IsoDate.nullable(),
  /** Messages per minute. The coordinator mints tokens at this rate. */
  throttle_per_minute: z.number().int().min(1).nullable().optional(),
  variants: z.array(BroadcastVariant).optional(),
  /** Fraction held back from the A/B test until a winner is chosen. */
  holdout_percent: z.number().int().min(0).max(90).nullable().optional(),
  /** Null on a broadcast with no A/B test, which is most of them. */
  winner_metric: z.enum(['opens', 'clicks']).nullable().optional(),
  /** The variant key that won, once the winner alarm has run. */
  winner_variant: z.string().nullable().optional(),
  /** True when the test ran and the difference did not reach significance. */
  ab_inconclusive: z.boolean().optional(),
  /** Known once the recipient set has been counted, not before. */
  total_recipients: z.number().int().nullable().optional(),
  stats: z
    .object({
      total: z.number().int(),
      sent: z.number().int(),
      delivered: z.number().int(),
      opened: z.number().int(),
      clicked: z.number().int(),
      bounced: z.number().int(),
      complained: z.number().int(),
      unsubscribed: z.number().int(),
    })
    .optional(),
})

export const CreateBroadcastRequest = z.object({
  name: z.string().max(200).optional(),
  audience_id: AudienceId,
  segment_id: SegmentId.optional(),
  from: emailAddress,
  subject: z.string().min(1).max(998),
  reply_to: z.union([emailAddress, z.array(emailAddress)]).optional(),
  preview_text: z.string().max(200).optional(),
  html: z.string().max(2_000_000).optional(),
  text: z.string().max(2_000_000).optional(),
  template_id: TemplateId.optional(),
  throttle_per_minute: z.number().int().min(1).max(1_000_000).optional(),
  variants: z.array(BroadcastVariant).min(2).max(4).optional(),
  holdout_percent: z.number().int().min(0).max(90).optional(),
  winner_metric: z.enum(['opens', 'clicks']).optional(),
})

export const SendBroadcastRequest = z.object({ scheduled_at: z.string().optional() })

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

export const AutomationTrigger = z.discriminatedUnion('type', [
  z.object({ type: z.literal('contact_created'), audience_id: AudienceId }),
  z.object({ type: z.literal('segment_entered'), segment_id: SegmentId }),
  z.object({ type: z.literal('segment_exited'), segment_id: SegmentId }),
  z.object({ type: z.literal('event'), name: z.string().min(1).max(120) }),
  z.object({ type: z.literal('api'), name: z.string().min(1).max(120) }),
  z.object({ type: z.literal('schedule'), cron: z.string().min(9).max(120) }),
])

/**
 * Steps are interpreted, not compiled — one generic Workflow class replays them.
 * Step ids are positional (`s0.send`) because Workflows replay by step id, so
 * reordering steps in a published version would corrupt in-flight instances;
 * editing therefore creates a new `automation_version`.
 */
export const AutomationStep = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('send'),
    template_id: TemplateId.optional(),
    subject: z.string().max(998).optional(),
    html: z.string().max(2_000_000).optional(),
    text: z.string().max(2_000_000).optional(),
    from: emailAddress.optional(),
  }),
  z.object({ type: z.literal('wait'), duration: z.string().max(40) }),
  z.object({
    type: z.literal('wait_until'),
    event: z.string().max(120),
    timeout: z.string().max(40),
  }),
  z.object({
    type: z.literal('branch'),
    condition: z.string().max(4000),
    // A branch arm in a stored JSON step, never a thenable — and renaming it
    // would break every automation already written against this contract.
    // biome-ignore lint/suspicious/noThenProperty: see above
    then: z.array(z.unknown()).max(50),
    otherwise: z.array(z.unknown()).max(50).optional(),
  }),
  z.object({
    type: z.literal('tag'),
    add: z.array(z.string()).optional(),
    remove: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('webhook'), url: z.string().url() }),
  z.object({ type: z.literal('exit') }),
])

export const Automation = z.object({
  object: z.literal('automation'),
  id: AutomationId,
  name: z.string(),
  status: z.enum(['draft', 'active', 'paused', 'archived']),
  /**
   * `cohort` is the default at audience scale: Workflows V2 caps 50,000
   * concurrent instances, so one instance per contact is impossible past ~40k.
   * Cohort mode runs one instance per (version, hourly cohort ≤ 25,000).
   */
  mode: z.enum(['cohort', 'instance']).default('cohort'),
  trigger: AutomationTrigger,
  steps: z.array(AutomationStep).min(1).max(100),
  version: z.number().int(),
  created_at: IsoDate,
  enrolled_count: z.number().int().optional(),
})

export const CreateAutomationRequest = Automation.pick({
  name: true,
  trigger: true,
  steps: true,
}).extend({
  mode: z.enum(['cohort', 'instance']).optional(),
})

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export const WebhookEventName = z.enum([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.opened',
  'email.clicked',
  'email.failed',
  'contact.created',
  'contact.updated',
  'contact.deleted',
  'contact.unsubscribed',
  'broadcast.sent',
  'broadcast.completed',
  'broadcast.ab_winner',
  'broadcast.ab_inconclusive',
  'domain.verified',
  'domain.failed',
  'inbound.received',
  'inbound.replied',
])

export const Webhook = z.object({
  object: z.literal('webhook'),
  id: WebhookId,
  url: z.string().url(),
  events: z.array(WebhookEventName).min(1),
  status: z.enum(['enabled', 'disabled']),
  created_at: IsoDate,
  /** Shown once at creation; used to verify `MailySend-Signature`. */
  secret: z.string().optional(),
  consecutive_failures: z.number().int().optional(),
})

export const CreateWebhookRequest = z.object({
  url: z.string().url(),
  events: z.array(WebhookEventName).min(1).max(40),
  description: z.string().max(200).optional(),
})

// ---------------------------------------------------------------------------
// Suppressions
// ---------------------------------------------------------------------------

export const SuppressionReason = z.enum([
  'hard_bounce',
  'complaint',
  'unsubscribe',
  'manual',
  /** Mirrored inward from a provider that suppressed on its own — see docs. */
  'provider',
])

export const Suppression = z.object({
  object: z.literal('suppression'),
  email: z.string(),
  reason: SuppressionReason,
  created_at: IsoDate,
  source: z.string().nullable().optional(),
  expires_at: IsoDate.nullable().optional(),
})

export const CreateSuppressionRequest = z.object({
  email: emailAddress,
  reason: SuppressionReason.default('manual'),
  /** Soft-bounce suppressions expire; hard bounces do not. */
  expires_at: IsoDate.optional(),
})

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

export const InboundMessage = z.object({
  object: z.literal('inbound_message'),
  id: z.string(),
  thread_id: ThreadId,
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  received_at: IsoDate,
  snippet: z.string(),
  html: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        content_type: z.string(),
        size: z.number().int(),
        url: z.string(),
      }),
    )
    .optional(),
  spf: z.enum(['pass', 'fail', 'softfail', 'neutral', 'none']).optional(),
  dkim: z.enum(['pass', 'fail', 'none']).optional(),
  dmarc: z.enum(['pass', 'fail', 'none']).optional(),
  /** `raw_only` when MIME parsing failed — the message is kept, never dropped. */
  parse_status: z.enum(['parsed', 'raw_only']).default('parsed'),
})

export const InboundThread = z.object({
  object: z.literal('inbound_thread'),
  id: ThreadId,
  subject: z.string(),
  participants: z.array(z.string()),
  message_count: z.number().int(),
  last_message_at: IsoDate,
  unread: z.boolean(),
  /** How the message was attached to this thread, in descending confidence. */
  matched_by: z
    .enum(['reply_token', 'in_reply_to', 'references', 'subject_participants', 'new'])
    .optional(),
})

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * Every placement figure carries where it came from. `250 OK` from an MTA means
 * *accepted*, not *inboxed* — a number derived from delivery events alone would
 * be a guess presented as a measurement, which is precisely the thing a
 * deliverability product cannot do.
 */
export const MetricSource = z.enum(['seed', 'postmaster', 'snds', 'estimate'])

export const PlacementFigure = z.object({
  provider: z.string(),
  inbox_percent: z.number(),
  spam_percent: z.number(),
  missing_percent: z.number(),
  source: MetricSource,
  confidence: z.enum(['high', 'medium', 'low']),
  sample_size: z.number().int().nullable(),
  measured_at: IsoDate,
})

export const StatsQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  granularity: z.enum(['hour', 'day', 'week', 'month']).default('day'),
  domain_id: DomainId.optional(),
  tag: z.string().optional(),
  provider: z.string().optional(),
  /** Open/click charts default to `human`; the others are kept and selectable. */
  audience_class: z
    .enum(['human', 'all', 'bot', 'mpp', 'scanner', 'proxy_prefetch'])
    .default('human'),
})

/**
 * Inferred types for every schema above.
 *
 * The schemas are the source of truth, so these are derived rather than
 * written — a hand-written interface beside a Zod schema is a second
 * definition that drifts the first time either changes.
 */
export type DnsRecord = z.infer<typeof DnsRecord>
export type Domain = z.infer<typeof Domain>
export type ApiKey = z.infer<typeof ApiKey>
export type CreatedApiKey = z.infer<typeof CreatedApiKey>
export type Audience = z.infer<typeof Audience>
export type Contact = z.infer<typeof Contact>
export type Segment = z.infer<typeof Segment>
export type Template = z.infer<typeof Template>
export type BroadcastVariant = z.infer<typeof BroadcastVariant>
export type Broadcast = z.infer<typeof Broadcast>
export type AutomationTrigger = z.infer<typeof AutomationTrigger>
export type AutomationStep = z.infer<typeof AutomationStep>
export type Automation = z.infer<typeof Automation>
export type Webhook = z.infer<typeof Webhook>
export type Suppression = z.infer<typeof Suppression>
export type InboundMessage = z.infer<typeof InboundMessage>
export type InboundThread = z.infer<typeof InboundThread>
export type PlacementFigure = z.infer<typeof PlacementFigure>
