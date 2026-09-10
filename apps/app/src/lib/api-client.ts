import {
  ApiKey,
  Audience,
  Automation,
  Broadcast,
  Contact,
  CreatedApiKey,
  Domain,
  Email,
  ErrorBody,
  InboundMessage,
  InboundThread,
  listResponse,
  PlacementFigure,
  Segment,
  Suppression,
  Template,
  Webhook,
} from '@mailysend/contracts'
import { z } from 'zod'

/**
 * The dashboard's only door to `/v1`.
 *
 * Every response is parsed with the same Zod schema the API validates against,
 * so a field the server renames becomes a loud runtime failure in one place
 * instead of `undefined` rendered as "NaN%" on four screens. Hand-written
 * response interfaces are what makes that class of drift invisible, so there
 * are none here.
 */

// ---------------------------------------------------------------------------
// Environment & workspace
// ---------------------------------------------------------------------------

/**
 * `ms_live_` and `ms_test_` are two different key prefixes over two different
 * datasets, so the dashboard is always looking at exactly one of them. The
 * header travels with every request rather than being a path segment: a bookmarked
 * URL that silently means "live" for one reader and "test" for another is worse
 * than one that reads the switch.
 */
export type Environment = 'live' | 'test'

export interface RequestScope {
  environment: Environment
  workspaceId?: string
}

const ENV_HEADER = 'ms-environment'
const WORKSPACE_HEADER = 'ms-workspace'

/**
 * Relative on the client. On the server there is no origin to be relative to,
 * so the dashboard's queries are client-only and this value is a fallback the
 * dev server happens to satisfy rather than a supported deployment knob.
 */
const baseUrl = (): string => {
  if (typeof window !== 'undefined') return ''
  return (globalThis as { MS_PUBLIC_URL?: string }).MS_PUBLIC_URL ?? 'http://localhost:8917'
}

export class ApiClientError extends Error {
  readonly status: number
  readonly body: ErrorBody | null

  constructor(status: number, body: ErrorBody | null, fallback: string) {
    super(body?.message ?? fallback)
    this.name = 'ApiClientError'
    this.status = status
    this.body = body
  }

  /** The stable machine code, when the server sent one. Never the HTTP status. */
  get code(): string | undefined {
    return this.body?.code
  }

  get docUrl(): string | undefined {
    return this.body?.doc_url
  }

  /** The single offending field, for attaching an error to one input. */
  get param(): string | undefined {
    return this.body?.param
  }
}

interface RequestInitEx extends Omit<RequestInit, 'body'> {
  body?: unknown
  query?: Record<string, unknown>
  scope?: RequestScope
}

const buildQuery = (query: RequestInitEx['query']): string => {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, Array.isArray(value) ? value.join(',') : String(value))
  }
  const serialized = params.toString()
  return serialized ? `?${serialized}` : ''
}

export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInitEx = {},
): Promise<T> {
  const { body, query, scope, headers, ...rest } = init
  const response = await fetch(`${baseUrl()}/v1${path}${buildQuery(query)}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(scope ? { [ENV_HEADER]: scope.environment } : {}),
      ...(scope?.workspaceId ? { [WORKSPACE_HEADER]: scope.workspaceId } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  if (!response.ok) {
    const parsed = ErrorBody.safeParse(await response.json().catch(() => null))
    throw new ApiClientError(
      response.status,
      parsed.success ? parsed.data : null,
      `${response.status} ${response.statusText}`,
    )
  }

  if (response.status === 204) return schema.parse(undefined)
  return schema.parse(await response.json())
}

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export type ListParams = {
  limit?: number
  after?: string
  before?: string
}

export type List<T> = { object: 'list'; data: T[]; has_more: boolean; next_cursor?: string | null }

const deleted = z.object({ object: z.string(), id: z.string(), deleted: z.literal(true) })

export type EmailRecord = z.infer<typeof Email>
export type DomainRecord = z.infer<typeof Domain>
export type ApiKeyRecord = z.infer<typeof ApiKey>
export type CreatedApiKeyRecord = z.infer<typeof CreatedApiKey>
export type AudienceRecord = z.infer<typeof Audience>
export type ContactRecord = z.infer<typeof Contact>
export type SegmentRecord = z.infer<typeof Segment>
export type TemplateRecord = z.infer<typeof Template>
export type BroadcastRecord = z.infer<typeof Broadcast>
export type AutomationRecord = z.infer<typeof Automation>
export type WebhookRecord = z.infer<typeof Webhook>
export type SuppressionRecord = z.infer<typeof Suppression>
export type InboundThreadRecord = z.infer<typeof InboundThread>
export type InboundMessageRecord = z.infer<typeof InboundMessage>
export type PlacementFigureRecord = z.infer<typeof PlacementFigure>

// ---------------------------------------------------------------------------
// Event timeline, SMTP conversation and webhook attempts
// ---------------------------------------------------------------------------

/**
 * The log drawer's payload. `/v1/emails/:id` returns the message; this endpoint
 * returns everything that happened to it, which is a different read pattern
 * (Analytics Engine + R2) and therefore a different call.
 */
export const EmailTimelineEvent = z.object({
  event_id: z.string(),
  type: z.string(),
  occurred_at: z.string(),
  recipient: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  smtp_code: z.string().nullable().optional(),
  smtp_response: z.string().nullable().optional(),
  diagnostic: z.string().nullable().optional(),
  bounce_class: z.string().nullable().optional(),
  audience_class: z.string().nullable().optional(),
  link_url: z.string().nullable().optional(),
  geo_country: z.string().nullable().optional(),
  user_agent: z.string().nullable().optional(),
})
export type EmailTimelineEventRecord = z.infer<typeof EmailTimelineEvent>

export const WebhookAttempt = z.object({
  id: z.string(),
  webhook_id: z.string(),
  event: z.string(),
  url: z.string(),
  status_code: z.number().int().nullable(),
  duration_ms: z.number().int().nullable(),
  attempt: z.number().int(),
  succeeded: z.boolean(),
  error: z.string().nullable().optional(),
  request_body: z.string().nullable().optional(),
  response_body: z.string().nullable().optional(),
  created_at: z.string(),
})
export type WebhookAttemptRecord = z.infer<typeof WebhookAttempt>

/** One attempt at delivering one event to one endpoint. */
export const WebhookDelivery = z.object({
  id: z.string(),
  endpoint_id: z.string(),
  url: z.string().nullable().optional(),
  event_id: z.string(),
  event_type: z.string(),
  attempt: z.number(),
  status: z.string(),
  response_status: z.number().nullable().optional(),
  response_body: z.string().nullable().optional(),
  duration_ms: z.number().nullable().optional(),
  created_at: z.string(),
})
export type WebhookDeliveryRecord = z.infer<typeof WebhookDelivery>

/**
 * `GET /v1/logs/:id`.
 *
 * This mirrors the endpoint rather than a nicer shape, because the drawer used
 * to parse `{ email, smtp_conversation, webhook_attempts }` — a payload the
 * server has never sent. Mirroring is what makes the contract check able to
 * catch the next drift; a translation layer would have hidden this one too.
 */
/**
 * `GET /v1/logs` — the log list. It is not the same shape as `GET /v1/emails`:
 * a log row is Resend-shaped only in spirit, carrying `status` rather than
 * `last_event` and a per-row `object: 'log'`. Validating it against `Email`
 * meant the contract check reported drift that was only ever in the check.
 */
export const LogEntry = z.object({
  object: z.literal('log'),
  id: z.string(),
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  status: z.string(),
  provider: z.string().nullable().optional(),
  provider_message_id: z.string().nullable().optional(),
  domain_id: z.string().nullable().optional(),
  broadcast_id: z.string().nullable().optional(),
  automation_id: z.string().nullable().optional(),
  contact_id: z.string().nullable().optional(),
  opens: z.number().nullable().optional(),
  clicks: z.number().nullable().optional(),
  bounce_class: z.string().nullable().optional(),
  smtp_code: z.string().nullable().optional(),
  smtp_response: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  size_bytes: z.number().nullable().optional(),
  attempts: z.number().nullable().optional(),
  scheduled_at: z.string().nullable().optional(),
  sent_at: z.string().nullable().optional(),
  delivered_at: z.string().nullable().optional(),
  created_at: z.string(),
})
export type LogEntryRecord = z.infer<typeof LogEntry>

export const EmailDetail = z.object({
  object: z.literal('log'),
  id: z.string(),
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  status: z.string(),
  provider: z.string().nullable().optional(),
  provider_message_id: z.string().nullable().optional(),
  domain_id: z.string().nullable().optional(),
  broadcast_id: z.string().nullable().optional(),
  opens: z.number().nullable().optional(),
  clicks: z.number().nullable().optional(),
  bounce_class: z.string().nullable().optional(),
  smtp_code: z.string().nullable().optional(),
  smtp_response: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  size_bytes: z.number().nullable().optional(),
  attempts: z.number().nullable().optional(),
  scheduled_at: z.string().nullable().optional(),
  sent_at: z.string().nullable().optional(),
  delivered_at: z.string().nullable().optional(),
  created_at: z.string(),
  tags: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  events: z.array(EmailTimelineEvent).default([]),
  /** One entry per moment a receiver said something, newest last. */
  smtp: z
    .array(
      z.object({
        at: z.string().nullable().optional(),
        code: z.string().nullable().optional(),
        response: z.string().nullable().optional(),
        source: z.string(),
      }),
    )
    .default([]),
  links: z
    .array(
      z.object({
        id: z.string(),
        url: z.string(),
        click_count: z.number(),
        unique_click_count: z.number(),
      }),
    )
    .default([]),
  webhook_deliveries: z.array(WebhookDelivery).default([]),
  /** The verbatim MIME the provider was handed. Kept in R2, never regenerated. */
  raw: z.unknown().nullable().optional(),
  raw_key: z.string().optional(),
  raw_available: z.boolean().optional(),
  event_detail: z.boolean().optional(),
})
export type EmailDetailRecord = z.infer<typeof EmailDetail>

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export const TimeseriesPoint = z.object({
  bucket: z.string(),
  sent: z.number(),
  delivered: z.number(),
  bounced: z.number(),
  complained: z.number(),
  opened: z.number(),
  clicked: z.number(),
})
export type TimeseriesPointRecord = z.infer<typeof TimeseriesPoint>

export const Breakdown = z.object({
  key: z.string(),
  sent: z.number(),
  delivered: z.number(),
  bounced: z.number(),
  opened: z.number(),
  clicked: z.number(),
})
export type BreakdownRecord = z.infer<typeof Breakdown>

export const EngagementSplit = z.object({
  audience_class: z.string(),
  opens: z.number(),
  clicks: z.number(),
})
export type EngagementSplitRecord = z.infer<typeof EngagementSplit>

export const AnalyticsOverview = z.object({
  timeseries: z.array(TimeseriesPoint),
  by_domain: z.array(Breakdown),
  by_tag: z.array(Breakdown),
  engagement: z.array(EngagementSplit),
  placement: z.array(PlacementFigure),
  totals: z.object({
    sent: z.number(),
    delivered: z.number(),
    bounced: z.number(),
    complained: z.number(),
    opened: z.number(),
    clicked: z.number(),
    unsubscribed: z.number(),
    /** Opens and recipients with MPP removed from *both* sides of the ratio. */
    human_opens: z.number(),
    human_delivered: z.number(),
  }),
})
export type AnalyticsOverviewRecord = z.infer<typeof AnalyticsOverview>

/**
 * Placement is not a plain list: every response carries whether the figures
 * were measured against seed mailboxes or estimated from delivery events, and
 * the note that explains the difference. Dropping that envelope would be how an
 * estimate ends up rendered as a measurement.
 */
export const PlacementReport = z.object({
  figures: z.array(PlacementFigure),
  has_seed_data: z.boolean(),
  note: z.string().optional(),
  seed_testing_available: z.boolean().optional(),
})
export type PlacementReportRecord = z.infer<typeof PlacementReport>

export type AnalyticsParams = {
  from?: string
  to?: string
  granularity?: 'hour' | 'day' | 'week' | 'month'
  domain_id?: string
  tag?: string
  provider?: string
  audience_class?: 'human' | 'all' | 'bot' | 'mpp' | 'scanner' | 'proxy_prefetch'
}

// ---------------------------------------------------------------------------
// Workspace, team & settings
// ---------------------------------------------------------------------------

export const ROLES = ['owner', 'developer', 'marketer', 'read_only'] as const
export const Role = z.enum(ROLES)
export type RoleName = z.infer<typeof Role>

export const Member = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  role: Role,
  created_at: z.string(),
  last_seen_at: z.string().nullable().optional(),
})
export type MemberRecord = z.infer<typeof Member>

export const Invite = z.object({
  id: z.string(),
  email: z.string(),
  role: Role,
  created_at: z.string(),
  expires_at: z.string(),
})
export type InviteRecord = z.infer<typeof Invite>

export const Workspace = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  created_at: z.string(),
  role: Role.optional(),
})
export type WorkspaceRecord = z.infer<typeof Workspace>

export const CurrentUser = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  avatar_url: z.string().nullable().optional(),
  workspaces: z.array(Workspace),
})
export type CurrentUserRecord = z.infer<typeof CurrentUser>

export const WorkspaceSettings = z.object({
  name: z.string(),
  /** The verified domain sign-in codes and system mail are sent from. */
  default_sending_domain: z.string().nullable().default(null),
  default_from: z.string().nullable(),
  default_reply_to: z.string().nullable(),
  open_tracking: z.boolean(),
  click_tracking: z.boolean(),
  provider: z.enum(['cloudflare', 'ses', 'resend', 'smtp']),
  failover_provider: z.enum(['cloudflare', 'ses', 'resend', 'smtp']).nullable(),
  /** Days. R2 is the store, so this is money as much as it is policy. */
  log_retention_days: z.number().int(),
  raw_message_retention_days: z.number().int(),
  suppression_sync: z.boolean(),
})
export type WorkspaceSettingsRecord = z.infer<typeof WorkspaceSettings>

export const DomainIdentity = z.object({
  object: z.literal('domain_identity'),
  provider: z.string(),
  status: z.enum(['verified', 'pending', 'failed', 'unknown']),
  detail: z.string().nullable(),
  /** A hand-off into the transport's own flow, where that flow is the real one. */
  external: z.object({ url: z.string(), label: z.string() }).nullable(),
  records: z.array(z.unknown()).optional(),
})
export type DomainIdentityRecord = z.infer<typeof DomainIdentity>

export const InboundMailbox = z.object({
  object: z.literal('inbound_mailbox'),
  id: z.string(),
  address: z.string(),
  name: z.string().nullable(),
  forward_webhook_id: z.string().nullable(),
  agent_enabled: z.boolean(),
  created_at: z.string(),
})
export type InboundMailboxRecord = z.infer<typeof InboundMailbox>

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

export const ProviderName = z.enum(['cloudflare', 'ses', 'resend', 'smtp'])
export type ProviderNameValue = z.infer<typeof ProviderName>

export const ProviderCatalogEntry = z.object({
  object: z.literal('provider_catalog_entry'),
  provider: ProviderName,
  label: z.string(),
  fields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      secret: z.boolean(),
      required: z.boolean(),
      help: z.string().optional(),
    }),
  ),
  config: z.array(z.object({ key: z.string(), label: z.string(), help: z.string().optional() })),
  maxMessageBytes: z.number(),
  reportsEvents: z.boolean(),
  managesIdentity: z.boolean(),
  caveats: z.array(z.string()),
  docs: z.string(),
  available_from_environment: z.boolean(),
})
export type ProviderCatalogRecord = z.infer<typeof ProviderCatalogEntry>

export const ProviderConfig = z.object({
  object: z.literal('provider'),
  id: z.string(),
  provider: ProviderName,
  enabled: z.boolean(),
  priority: z.number(),
  weight: z.number(),
  /** Field *names* only. There is no read path for a stored secret. */
  credentials_set: z.array(z.string()),
  config: z.record(z.string(), z.unknown()),
  updated_at: z.string(),
})
export type ProviderConfigRecord = z.infer<typeof ProviderConfig>

export const ProviderTest = z.object({
  object: z.literal('provider_test'),
  provider: ProviderName,
  /** Three answers, and `unknown` is a real one. */
  status: z.enum(['ok', 'unknown', 'failed']),
  detail: z.string().nullable(),
  reports_events: z.boolean().optional(),
  max_message_bytes: z.number().optional(),
})
export type ProviderTestRecord = z.infer<typeof ProviderTest>

// ---------------------------------------------------------------------------
// Seed-list placement testing
// ---------------------------------------------------------------------------

export const SeedTest = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['queued', 'sending', 'collecting', 'complete', 'failed']),
  created_at: z.string(),
  seed_count: z.number().int(),
  received_count: z.number().int(),
  results: z.array(PlacementFigure).optional(),
})
export type SeedTestRecord = z.infer<typeof SeedTest>

// ---------------------------------------------------------------------------
// Preference centre
// ---------------------------------------------------------------------------

export const PreferenceTopic = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  default_opted_in: z.boolean(),
  subscriber_count: z.number().int().optional(),
})
export type PreferenceTopicRecord = z.infer<typeof PreferenceTopic>

export const PreferenceCentre = z.object({
  headline: z.string(),
  body: z.string(),
  /** The one link that must always exist, whatever the topics do. */
  show_unsubscribe_all: z.boolean(),
  topics: z.array(PreferenceTopic),
})
export type PreferenceCentreRecord = z.infer<typeof PreferenceCentre>

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

export const ImportRowError = z.object({
  row: z.number().int(),
  email: z.string().nullable(),
  code: z.string(),
  message: z.string(),
})
export type ImportRowErrorRecord = z.infer<typeof ImportRowError>

export const ImportResult = z.object({
  id: z.string(),
  status: z.enum(['validating', 'importing', 'complete', 'failed']),
  total_rows: z.number().int(),
  imported: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  errors: z.array(ImportRowError),
})
export type ImportResultRecord = z.infer<typeof ImportResult>

// ---------------------------------------------------------------------------
// Segment preview
// ---------------------------------------------------------------------------

export const SegmentPreview = z.object({
  valid: z.boolean(),
  /** `describe()` output — the expression as a sentence, from the parser. */
  describe: z.string().nullable(),
  error: z.string().nullable(),
  match_count: z.number().int().nullable(),
  sample: z.array(Contact),
})
export type SegmentPreviewRecord = z.infer<typeof SegmentPreview>

// ---------------------------------------------------------------------------
// Template versions
// ---------------------------------------------------------------------------

/**
 * The list endpoint returns metadata; only the single-version endpoint carries
 * the bodies, because a version list of a template with a 200 KB body would
 * otherwise be a megabyte of HTML nobody asked for. The body fields are
 * therefore optional here, not missing from one of the two shapes.
 */
export const TemplateVersion = z.object({
  version: z.number().int(),
  created_at: z.string(),
  template_id: z.string().optional(),
  subject: z.string().nullable(),
  variables: z.array(z.string()).optional(),
  published: z.boolean().optional(),
  created_by: z.string().nullable().optional(),
  html: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
})
export type TemplateVersionRecord = z.infer<typeof TemplateVersion>

// ---------------------------------------------------------------------------
// Mail — one conversation model over both directions
// ---------------------------------------------------------------------------

export const MailAttachment = z.object({
  object: z.literal('mail_attachment'),
  id: z.string(),
  filename: z.string(),
  content_type: z.string(),
  size: z.number().int(),
  content_id: z.string().nullable(),
  inline: z.boolean(),
  /** Fetched by the parent and handed to the frame as a `blob:` URL. */
  url: z.string(),
})
export type MailAttachmentRecord = z.infer<typeof MailAttachment>

export const MailThread = z.object({
  object: z.literal('mail_thread'),
  id: z.string(),
  mailbox_id: z.string().nullable(),
  environment: z.string(),
  subject: z.string(),
  participants: z.array(z.string()),
  message_count: z.number().int(),
  unread_count: z.number().int(),
  unread: z.boolean(),
  has_attachments: z.boolean(),
  starred: z.boolean(),
  folder: z.enum(['inbox', 'sent', 'archive', 'spam', 'trash']),
  labels: z.array(z.string()),
  snoozed_until: z.string().nullable(),
  last_message_at: z.string(),
  last_direction: z.enum(['in', 'out']),
  snippet: z.string().nullable(),
  created_at: z.string(),
})
export type MailThreadRecord = z.infer<typeof MailThread>

export const MailMessage = z.object({
  object: z.literal('mail_message'),
  id: z.string(),
  thread_id: z.string(),
  direction: z.enum(['in', 'out']),
  mailbox_id: z.string().nullable(),
  source_id: z.string().nullable(),
  message_id: z.string().nullable(),
  in_reply_to: z.string().nullable(),
  references: z.array(z.string()),
  from: z.string(),
  from_name: z.string().nullable(),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  bcc: z.array(z.string()),
  reply_to: z.string().nullable(),
  subject: z.string(),
  snippet: z.string().nullable(),
  has_attachments: z.boolean(),
  unread: z.boolean(),
  size_bytes: z.number().int().nullable(),
  /** Null on outbound and on the test-mode loopback: nothing authenticated them. */
  spf: z.string().nullable(),
  dkim: z.string().nullable(),
  dmarc: z.string().nullable(),
  spam_score: z.number().nullable(),
  parse_status: z.string().nullable(),
  /** Which threading signal won — `reply_token` beats every RFC header. */
  matched_by: z.string().nullable(),
  status: z.string().nullable(),
  at: z.string(),
  email_id: z.string().nullable(),
  html: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  body_available: z.boolean().optional(),
  has_raw: z.boolean().optional(),
  attachments: z.array(MailAttachment).optional(),
})
export type MailMessageRecord = z.infer<typeof MailMessage>

/** `GET /v1/mail/threads/:id` — the thread with its messages already inlined. */
export const MailThreadDetail = MailThread.extend({ messages: z.array(MailMessage) })
export type MailThreadDetailRecord = z.infer<typeof MailThreadDetail>

export const MailCounts = z.object({
  object: z.literal('mail_counts'),
  environment: z.string(),
  folders: z.record(z.string(), z.object({ threads: z.number(), unread: z.number() })),
})
export type MailCountsRecord = z.infer<typeof MailCounts>

/**
 * One address this workspace can send as. `source` says where it came from and
 * `can_receive_replies` says whether anything is listening behind it — the two
 * facts the old hardcoded `mail@domain` string could not carry.
 */
export const ContactSuggestion = z.object({
  object: z.literal('contact_suggestion'),
  id: z.string(),
  audience_id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
})
export type ContactSuggestionRecord = z.infer<typeof ContactSuggestion>

export const MailIdentity = z.object({
  object: z.literal('mail_identity'),
  address: z.string(),
  name: z.string().nullable().optional(),
  domain: z.string(),
  domain_id: z.string().nullable().optional(),
  domain_status: z.string(),
  source: z.enum(['mailbox', 'domain', 'test']),
  can_receive_replies: z.boolean(),
})
export type MailIdentityRecord = z.infer<typeof MailIdentity>

export const MailIdentityList = z.object({
  object: z.literal('list'),
  data: z.array(MailIdentity),
  sendable_domains: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
})

export const MailLabel = z.object({
  object: z.literal('mail_label'),
  id: z.string(),
  name: z.string().optional(),
  colour: z.string().optional(),
  created_at: z.string().optional(),
  deleted: z.boolean().optional(),
})
export type MailLabelRecord = z.infer<typeof MailLabel>

export const MailDraft = z.object({
  object: z.literal('mail_draft'),
  id: z.string(),
  thread_id: z.string().nullable().optional(),
  mode: z.string().nullable().optional(),
  from: z.string().nullable().optional(),
  to: z.array(z.string()).optional(),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().nullable().optional(),
  html: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  deleted: z.boolean().optional(),
})
export type MailDraftRecord = z.infer<typeof MailDraft>

export const MailHeader = z.object({ name: z.string(), value: z.string() })

export const MailUpload = z.object({
  object: z.literal('mail_upload'),
  id: z.string(),
  key: z.string(),
  filename: z.string(),
  content_type: z.string(),
  size: z.number().int(),
})
export type MailUploadRecord = z.infer<typeof MailUpload>

export const MailSendResult = z.object({
  object: z.literal('mail_send'),
  id: z.string(),
  thread_id: z.string().nullable(),
  environment: z.string(),
  suppressed: z.array(z.string()).optional(),
  created_at: z.string(),
})

export const MailBulkResult = z.object({
  object: z.literal('mail_bulk'),
  updated: z.number().int(),
})

/**
 * One parsed term of a search, as the server understood it.
 *
 * `operator` is null for a bare word, which goes to full-text search; anything
 * else is one of the operators in `mail-search.ts`.
 */
export const MailQueryTerm = z.object({
  operator: z.string().nullable(),
  value: z.string(),
  negated: z.boolean(),
})
export type MailQueryTermRecord = z.infer<typeof MailQueryTerm>

/**
 * The thread list carries the parsed query back so the search bar can show what
 * the server actually understood — an operator we silently dropped is how a
 * reader ends up trusting a filtered list that was never filtered.
 */
export const MailThreadList = z.object({
  object: z.literal('list'),
  data: z.array(MailThread),
  has_more: z.boolean(),
  next_cursor: z.string().nullable().optional(),
  query: z.array(MailQueryTerm).optional(),
})
export type MailThreadListRecord = z.infer<typeof MailThreadList>

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

const list = <T>(item: z.ZodType<T>) => listResponse(item) as unknown as z.ZodType<List<T>>

/**
 * Bound to one environment and workspace. Screens never pass the scope around;
 * they take a client from `useApi()`, which already carries the switch's value.
 */
export const createApiClient = (scope: RequestScope) => {
  const call = <T>(path: string, schema: z.ZodType<T>, init: RequestInitEx = {}) =>
    request(path, schema, { ...init, scope })

  const get = <T>(path: string, schema: z.ZodType<T>, query?: RequestInitEx['query']) =>
    call(path, schema, { method: 'GET', query })

  const post = <T>(path: string, schema: z.ZodType<T>, body?: unknown) =>
    call(path, schema, { method: 'POST', body })

  const patch = <T>(path: string, schema: z.ZodType<T>, body?: unknown) =>
    call(path, schema, { method: 'PATCH', body })

  const put = <T>(path: string, schema: z.ZodType<T>, body?: unknown) =>
    call(path, schema, { method: 'PUT', body })

  const del = <T>(path: string, schema: z.ZodType<T>) => call(path, schema, { method: 'DELETE' })

  return {
    scope,

    // --- session -----------------------------------------------------------
    me: () => get('/me', CurrentUser),

    // --- emails & logs -----------------------------------------------------
    listEmails: (params: ListParams & Record<string, unknown> = {}) =>
      get('/emails', list(Email), params),
    getEmail: (id: string) => get(`/emails/${id}`, Email),
    // `/logs/:id`, not `/emails/:id/detail`: the drawer's payload is the log
    // read — row, timeline, SMTP conversation, webhook attempts and the spooled
    // envelope — and that endpoint has always lived under /logs.
    getEmailDetail: (id: string) => get(`/logs/${id}`, EmailDetail),
    cancelEmail: (id: string) => post(`/emails/${id}/cancel`, Email),
    rescheduleEmail: (id: string, scheduledAt: string) =>
      patch(`/emails/${id}`, Email, { scheduled_at: scheduledAt }),
    listLogs: (params: Record<string, unknown> = {}) => get('/logs', list(LogEntry), params),

    // --- domains -----------------------------------------------------------
    listDomains: (params: ListParams = {}) => get('/domains', list(Domain), params),
    getDomain: (id: string) => get(`/domains/${id}`, Domain),
    createDomain: (body: {
      name: string
      region?: string
      custom_return_path?: string
      provider?: string
    }) => post('/domains', Domain, body),
    verifyDomain: (id: string) => post(`/domains/${id}/verify`, Domain),
    updateDomain: (id: string, body: Record<string, unknown>) =>
      patch(`/domains/${id}`, Domain, body),
    deleteDomain: (id: string) => del(`/domains/${id}`, deleted),
    /** Asks the bound transport to create the identity, and takes its records over ours. */
    ensureDomainIdentity: (id: string) => post(`/domains/${id}/identity`, DomainIdentity, {}),
    /** Optional accelerator: writes the records through a Cloudflare token, where one exists. */
    automateDomainDns: (id: string) =>
      post(
        `/domains/${id}/dns`,
        z.object({
          object: z.literal('domain_dns_automation'),
          zone_id: z.string(),
          written: z.array(z.string()),
          refused: z.array(z.object({ name: z.string(), detail: z.string() })),
          /** True when this transport publishes its own records and we wrote none. */
          nothing_to_write: z.boolean().default(false),
          detail: z.string(),
        }),
        {},
      ),
    /** A plain URL rather than a fetch: the browser downloads it directly. */
    domainZoneFileUrl: (id: string) => `${baseUrl()}/v1/domains/${id}/zone-file`,

    // --- receiving ---------------------------------------------------------
    listMailboxes: () => get('/inbound/mailboxes', list(InboundMailbox)),
    createMailbox: (body: { address: string; name?: string; agent_enabled?: boolean }) =>
      post('/inbound/mailboxes', InboundMailbox, body),
    updateMailbox: (id: string, body: Record<string, unknown>) =>
      patch(`/inbound/mailboxes/${id}`, InboundMailbox, body),
    deleteMailbox: (id: string) => del(`/inbound/mailboxes/${id}`, deleted),

    // --- api keys ----------------------------------------------------------
    listApiKeys: (params: ListParams = {}) => get('/api-keys', list(ApiKey), params),
    createApiKey: (body: Record<string, unknown>) => post('/api-keys', CreatedApiKey, body),
    deleteApiKey: (id: string) => del(`/api-keys/${id}`, deleted),

    // --- audiences & contacts ---------------------------------------------
    listAudiences: (params: ListParams = {}) => get('/audiences', list(Audience), params),
    getAudience: (id: string) => get(`/audiences/${id}`, Audience),
    createAudience: (body: { name: string }) => post('/audiences', Audience, body),
    deleteAudience: (id: string) => del(`/audiences/${id}`, deleted),

    /**
     * Address lookahead across every audience, for the composer's recipient
     * field. The per-audience list is the wrong shape there: a person typing a
     * name has no idea which audience the address is filed under.
     */
    searchContacts: (q: string) => get('/contacts/search', list(ContactSuggestion), { q }),
    listContacts: (audienceId: string, params: ListParams & Record<string, unknown> = {}) =>
      get(`/audiences/${audienceId}/contacts`, list(Contact), params),
    getContact: (audienceId: string, id: string) =>
      get(`/audiences/${audienceId}/contacts/${id}`, Contact),
    createContact: (audienceId: string, body: Record<string, unknown>) =>
      post(`/audiences/${audienceId}/contacts`, Contact, body),
    updateContact: (audienceId: string, id: string, body: Record<string, unknown>) =>
      patch(`/audiences/${audienceId}/contacts/${id}`, Contact, body),
    deleteContact: (audienceId: string, id: string) =>
      del(`/audiences/${audienceId}/contacts/${id}`, deleted),
    importContacts: (audienceId: string, body: { csv: string; mapping: Record<string, string> }) =>
      post(`/audiences/${audienceId}/import`, ImportResult, body),

    // --- segments ----------------------------------------------------------
    listSegments: (params: ListParams = {}) => get('/segments', list(Segment), params),
    getSegment: (id: string) => get(`/segments/${id}`, Segment),
    createSegment: (body: Record<string, unknown>) => post('/segments', Segment, body),
    updateSegment: (id: string, body: Record<string, unknown>) =>
      patch(`/segments/${id}`, Segment, body),
    deleteSegment: (id: string) => del(`/segments/${id}`, deleted),
    previewSegment: (body: { audience_id: string; expression: string }) =>
      post('/segments/preview', SegmentPreview, body),

    // --- templates ---------------------------------------------------------
    listTemplates: (params: ListParams = {}) => get('/templates', list(Template), params),
    getTemplate: (id: string) => get(`/templates/${id}`, Template),
    createTemplate: (body: Record<string, unknown>) => post('/templates', Template, body),
    updateTemplate: (id: string, body: Record<string, unknown>) =>
      patch(`/templates/${id}`, Template, body),
    deleteTemplate: (id: string) => del(`/templates/${id}`, deleted),
    listTemplateVersions: (id: string) => get(`/templates/${id}/versions`, list(TemplateVersion)),
    getTemplateVersion: (id: string, version: number) =>
      get(`/templates/${id}/versions/${version}`, TemplateVersion),
    rollbackTemplate: (id: string, version: number) =>
      post(`/templates/${id}/versions/${version}/rollback`, Template),

    // --- broadcasts --------------------------------------------------------
    listBroadcasts: (params: ListParams = {}) => get('/broadcasts', list(Broadcast), params),
    getBroadcast: (id: string) => get(`/broadcasts/${id}`, Broadcast),
    createBroadcast: (body: Record<string, unknown>) => post('/broadcasts', Broadcast, body),
    updateBroadcast: (id: string, body: Record<string, unknown>) =>
      patch(`/broadcasts/${id}`, Broadcast, body),
    sendBroadcast: (id: string, body: { scheduled_at?: string } = {}) =>
      post(`/broadcasts/${id}/send`, Broadcast, body),
    pauseBroadcast: (id: string) => post(`/broadcasts/${id}/pause`, Broadcast),
    resumeBroadcast: (id: string) => post(`/broadcasts/${id}/resume`, Broadcast),
    cancelBroadcast: (id: string) => post(`/broadcasts/${id}/cancel`, Broadcast),
    deleteBroadcast: (id: string) => del(`/broadcasts/${id}`, deleted),

    // --- automations -------------------------------------------------------
    listAutomations: (params: ListParams = {}) => get('/automations', list(Automation), params),
    getAutomation: (id: string) => get(`/automations/${id}`, Automation),
    createAutomation: (body: Record<string, unknown>) => post('/automations', Automation, body),
    updateAutomation: (id: string, body: Record<string, unknown>) =>
      patch(`/automations/${id}`, Automation, body),
    deleteAutomation: (id: string) => del(`/automations/${id}`, deleted),

    // --- webhooks ----------------------------------------------------------
    listWebhooks: (params: ListParams = {}) => get('/webhooks', list(Webhook), params),
    getWebhook: (id: string) => get(`/webhooks/${id}`, Webhook),
    createWebhook: (body: Record<string, unknown>) => post('/webhooks', Webhook, body),
    updateWebhook: (id: string, body: Record<string, unknown>) =>
      patch(`/webhooks/${id}`, Webhook, body),
    deleteWebhook: (id: string) => del(`/webhooks/${id}`, deleted),
    listWebhookAttempts: (id: string, params: ListParams = {}) =>
      get(`/webhooks/${id}/attempts`, list(WebhookAttempt), params),
    replayWebhookAttempt: (id: string, attemptId: string) =>
      post(`/webhooks/${id}/attempts/${attemptId}/replay`, WebhookAttempt),

    // --- suppressions ------------------------------------------------------
    listSuppressions: (params: ListParams & Record<string, unknown> = {}) =>
      get('/suppressions', list(Suppression), params),
    createSuppression: (body: Record<string, unknown>) => post('/suppressions', Suppression, body),
    deleteSuppression: (email: string) =>
      del(`/suppressions/${encodeURIComponent(email)}`, deleted),

    // --- inbound -----------------------------------------------------------
    listThreads: (params: ListParams & Record<string, unknown> = {}) =>
      get('/inbound/threads', list(InboundThread), params),
    getThread: (id: string) => get(`/inbound/threads/${id}`, InboundThread),
    listThreadMessages: (id: string) =>
      get(`/inbound/threads/${id}/messages`, list(InboundMessage)),
    replyToThread: (id: string, body: { text: string; html?: string }) =>
      post(`/inbound/threads/${id}/reply`, InboundMessage, body),
    markThreadRead: (id: string, unread: boolean) =>
      patch(`/inbound/threads/${id}`, InboundThread, { unread }),

    // --- mail --------------------------------------------------------------
    // One surface over both directions. `/v1/inbound/*` still exists as a shim
    // over the same tables, but nothing in the dashboard calls it any more.
    listMailThreads: (params: Record<string, unknown> = {}) =>
      get('/mail/threads', MailThreadList, params),
    mailCounts: () => get('/mail/counts', MailCounts),
    getMailThread: (id: string) => get(`/mail/threads/${id}`, MailThreadDetail),
    listMailMessages: (id: string) => get(`/mail/threads/${id}/messages`, list(MailMessage)),
    patchMailThread: (id: string, body: Record<string, unknown>) =>
      patch(`/mail/threads/${id}`, MailThread, body),
    bulkMailThreads: (body: Record<string, unknown>) =>
      post('/mail/threads/bulk', MailBulkResult, body),
    deleteMailThread: (id: string) =>
      del(
        `/mail/threads/${id}`,
        z.object({ object: z.string(), id: z.string(), deleted: z.literal(true) }),
      ),
    getMailMessage: (id: string) => get(`/mail/messages/${id}`, MailMessage),
    listMailHeaders: (id: string) => get(`/mail/messages/${id}/headers`, list(MailHeader)),
    /** Not a JSON call: the raw `.eml` is bytes, and the reader shows them verbatim. */
    getMailRaw: async (id: string): Promise<string> => {
      const response = await fetch(`${baseUrl()}/v1/mail/messages/${id}/raw`, {
        credentials: 'include',
        headers: { [ENV_HEADER]: scope.environment },
      })
      if (!response.ok) throw new ApiClientError(response.status, null, 'No stored original.')
      return response.text()
    },
    /** Fetched with credentials in the parent so the opaque-origin frame needs none. */
    getMailAttachmentBlob: async (id: string): Promise<Blob> => {
      const response = await fetch(`${baseUrl()}/v1/mail/attachments/${id}`, {
        credentials: 'include',
        headers: { [ENV_HEADER]: scope.environment },
      })
      if (!response.ok) throw new ApiClientError(response.status, null, 'Attachment unavailable.')
      return response.blob()
    },
    uploadMailAttachment: async (file: File): Promise<MailUploadRecord> => {
      const form = new FormData()
      form.set('file', file)
      const response = await fetch(`${baseUrl()}/v1/mail/attachments`, {
        method: 'POST',
        credentials: 'include',
        headers: { [ENV_HEADER]: scope.environment },
        body: form,
      })
      if (!response.ok) {
        const parsed = ErrorBody.safeParse(await response.json().catch(() => null))
        throw new ApiClientError(
          response.status,
          parsed.success ? parsed.data : null,
          'Upload failed.',
        )
      }
      return MailUpload.parse(await response.json())
    },
    sendMail: (body: Record<string, unknown>) => post('/mail/send', MailSendResult, body),
    listMailIdentities: () => get('/mail/identities', MailIdentityList),
    listMailLabels: () => get('/mail/labels', list(MailLabel)),
    createMailLabel: (body: { name: string; colour?: string }) =>
      post('/mail/labels', MailLabel, body),
    deleteMailLabel: (id: string) => del(`/mail/labels/${id}`, MailLabel),
    listMailDrafts: () => get('/mail/drafts', list(MailDraft)),
    saveMailDraft: (id: string, body: Record<string, unknown>) =>
      put(`/mail/drafts/${id}`, MailDraft, body),
    deleteMailDraft: (id: string) => del(`/mail/drafts/${id}`, MailDraft),

    // --- analytics ---------------------------------------------------------
    // `/dashboard`, not `/overview`: the screens need the series, the two
    // breakdowns, engagement, placement and the totals for one range, and
    // taking them from one response is what stops a chart and a total being
    // computed over ranges that drifted apart between requests.
    analytics: (params: AnalyticsParams = {}) =>
      get('/analytics/dashboard', AnalyticsOverview, params),
    placement: (params: AnalyticsParams = {}) =>
      get('/analytics/placement', PlacementReport, params),

    // --- seed tests --------------------------------------------------------
    listSeedTests: (params: ListParams = {}) =>
      get('/analytics/placement-tests', list(SeedTest), params),
    getSeedTest: (id: string) => get(`/analytics/placement-tests/${id}`, SeedTest),
    createSeedTest: (body: Record<string, unknown>) =>
      post('/analytics/placement-tests', SeedTest, body),

    // --- transports --------------------------------------------------------
    listProviders: () =>
      get(
        '/providers',
        listResponse(ProviderConfig).extend({
          environment_fallback: z.array(ProviderName).default([]),
          /**
           * What a send would actually leave through with nothing enabled here.
           * Computed server-side from the router's own order rather than guessed
           * from the fallback list, so the screen cannot drift from the code.
           */
          default_provider: ProviderName.nullable().default(null),
        }),
      ),
    providerCatalog: () => get('/providers/catalog', list(ProviderCatalogEntry)),
    saveProvider: (name: string, body: Record<string, unknown>) =>
      put(`/providers/${name}`, ProviderConfig, body),
    testProvider: (name: string) => post(`/providers/${name}/test`, ProviderTest, {}),
    deleteProvider: (name: string) =>
      del(`/providers/${name}`, z.object({ object: z.string(), deleted: z.literal(true) })),

    // --- settings, team, preference centre ---------------------------------
    getSettings: () => get('/workspace/settings', WorkspaceSettings),
    setDefaultSendingDomain: (domainId: string | null) =>
      put(
        '/workspace/sending-domain',
        z.object({ object: z.string(), default_sending_domain: z.string().nullable() }),
        { domain_id: domainId },
      ),
    updateSettings: (body: Record<string, unknown>) =>
      patch('/workspace/settings', WorkspaceSettings, body),
    deleteWorkspace: (id: string) => del(`/workspace/${id}`, deleted),

    listMembers: () => get('/workspace/members', list(Member)),
    updateMemberRole: (id: string, role: RoleName) =>
      patch(`/workspace/members/${id}`, Member, { role }),
    removeMember: (id: string) => del(`/workspace/members/${id}`, deleted),
    listInvites: () => get('/workspace/invites', list(Invite)),
    createInvite: (body: { email: string; role: RoleName }) =>
      post('/workspace/invites', Invite, body),
    revokeInvite: (id: string) => del(`/workspace/invites/${id}`, deleted),

    getPreferenceCentre: () => get('/preference-centre', PreferenceCentre),
    updatePreferenceCentre: (body: Record<string, unknown>) =>
      patch('/preference-centre', PreferenceCentre, body),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
