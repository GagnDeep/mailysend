/**
 * The public type surface.
 *
 * These are restated here rather than re-exported from `@mailysend/contracts`
 * for one reason: this package is published to npm and the contracts package is
 * not. A declaration file that says `import('@mailysend/contracts').Domain`
 * resolves to nothing on a consumer's machine, so the types have to be
 * self-contained at the package boundary.
 *
 * Restating a type is how definitions drift, so `contract-conformance.ts`
 * asserts assignability against the real schemas at build time. That file is
 * type-only and never reaches the bundle; its whole job is to fail `tsc` the
 * day the API contract and this file disagree.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** A bare address, or `Display Name <addr@example.com>`. */
export type EmailAddress = string

/** Anywhere the API accepts `string | string[]`, so do we. */
export type EmailAddressList = EmailAddress | EmailAddress[]

export interface Tag {
  name: string
  value: string
}

export interface Attachment {
  /** base64, or a byte array. Mutually exclusive with `path`. */
  content?: string | number[]
  filename: string
  /** Fetched server-side at render time. */
  path?: string
  content_type?: string
  /** Set for inline images referenced as `cid:<content_id>` in the HTML. */
  content_id?: string
}

export interface ListResponse<T> {
  object: 'list'
  data: T[]
  has_more: boolean
  next_cursor?: string | null
}

export interface CreatedResponse<T extends string> {
  object: T
  id: string
}

export interface DeletedResponse<T extends string> {
  object: T
  id: string
  deleted: true
}

/** Keyset pagination. Never an offset — offsets get slower as data grows. */
export interface PaginationParams {
  limit?: number
  after?: string
  before?: string
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface ErrorBody {
  statusCode: number
  /** Resend-compatible error name, e.g. `validation_error`. */
  name: string
  message: string
  /** Stable machine code. Never reused, never renamed. */
  code: string
  /** The offending field, in dotted path form, when there is exactly one. */
  param?: string
  doc_url?: string
  /** Present on 429 and on provider-quota errors. Seconds. */
  retry_after?: number
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

export type EmailStatus =
  | 'queued'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'delivery_delayed'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'canceled'

export type EmailEventType =
  | 'email.sent'
  | 'email.delivered'
  | 'email.delivery_delayed'
  | 'email.bounced'
  | 'email.complained'
  | 'email.opened'
  | 'email.clicked'
  | 'email.failed'
  | 'email.scheduled'
  | 'email.canceled'

export type ProviderName = 'cloudflare' | 'ses' | 'resend' | 'smtp'

export interface SendEmailRequest {
  from: EmailAddress
  to: EmailAddressList
  subject: string

  bcc?: EmailAddressList
  cc?: EmailAddressList
  reply_to?: EmailAddressList

  html?: string
  text?: string
  /** Pre-rendered React Email output. */
  react?: string

  headers?: Record<string, string>
  attachments?: Attachment[]
  tags?: Tag[]
  /** ISO-8601, or natural language: `in 1 min`, `tomorrow at 9am`. */
  scheduled_at?: string

  /** Render a stored template instead of supplying a body. */
  template_id?: string
  template_data?: Record<string, unknown>
  /** Pin this message to one transport, bypassing the workspace's routing rules. */
  provider?: ProviderName
  tracking?: { opens?: boolean; clicks?: boolean }
  /** Suppression is skipped only for transactional mail that legally must send. */
  ignore_suppression?: boolean
}

export interface SendEmailResponse {
  id: string
  created_at?: string
}

export type BatchSendRequest = SendEmailRequest[]

export interface BatchSendResponse {
  data: ({ id: string } | { index: number; error: { name: string; message: string } })[]
}

export interface Email {
  object: 'email'
  id: string
  to: string[]
  from: string
  created_at: string
  subject: string
  bcc: string[] | null
  cc: string[] | null
  reply_to: string[] | null
  last_event: EmailStatus
  html?: string | null
  text?: string | null
  scheduled_at?: string | null
  tags?: Tag[]
  /** Null until a transport is chosen; the id is minted before that happens. */
  provider?: string | null
  provider_message_id?: string | null
  opens?: number
  clicks?: number
}

export interface UpdateEmailRequest {
  scheduled_at: string
}

export interface EmailEvent {
  type: EmailEventType
  created_at: string
  data?: Record<string, unknown>
}

export interface ListEmailsParams extends PaginationParams {
  status?: EmailStatus
  domain_id?: string
  provider?: string
  broadcast_id?: string
  automation_id?: string
  recipient?: string
  tag_name?: string
  tag_value?: string
  from?: string
  to?: string
  search?: string
}

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

export type DomainStatus = 'not_started' | 'pending' | 'verified' | 'failed' | 'temporary_failure'

export interface DnsRecord {
  record: 'TXT' | 'MX' | 'CNAME'
  name: string
  value: string
  type: string
  ttl: string
  priority?: number
  /**
   * `error` means the lookup did not happen — the resolver was unreachable, or
   * the zone's nameservers failed to answer. It is not `failed`, which is a
   * record that exists and disagrees, and it is emphatically not `verified`.
   */
  status: 'not_started' | 'pending' | 'verified' | 'failed' | 'error'
  /** Which transport needs this record. */
  provider: ProviderName | 'all'
  purpose?: string
  /** Who publishes it. `observe` is a record the transport writes itself. */
  origin?: 'copy' | 'observe'
  /** How the resolved value is compared. */
  match?: 'exact' | 'include' | 'prefix'
  /** What actually resolved, so a failed row can show the difference. */
  found?: string | null
  /** Why the lookup could not be made, when `status` is `error`. */
  error?: string | null
  /** The value we asked for, so the row can show found against expected. */
  expected?: string | null
  /** When the resolver last looked. Null means never checked, not "failed". */
  last_checked_at?: string | null
}

export interface Domain {
  object: 'domain'
  id: string
  name: string
  status: DomainStatus
  created_at: string
  region: string
  records?: DnsRecord[]
  dkim_ready?: boolean
  spf_ready?: boolean
  /** Null until DMARC has been read; `missing` means it was read and absent. */
  dmarc_policy?: 'none' | 'quarantine' | 'reject' | 'missing' | null
  /** Learned from provider rejections; null before the first send. */
  daily_quota?: number | null
  open_tracking: boolean
  click_tracking: boolean
  custom_return_path: string
  /** The DKIM selector the records were minted for; `ms1` unless overridden. */
  dkim_selector?: string
  /** Outbound TLS policy. `enforced` fails a send rather than downgrading. */
  tls?: 'opportunistic' | 'enforced'
  /** Null until the first successful verification, then the last that passed. */
  last_verified_at?: string | null
  /** The transport the records were derived from. Null = workspace default. */
  provider?: ProviderName | null
  /**
   * How much of the last verification actually happened. Present on a verify
   * response only: a check that could reach the resolver for two of six records
   * used to be indistinguishable from one that checked all six.
   */
  checked?: {
    total: number
    resolved: number
    errored: number
    first_error?: string | null
  }
  /** What the transport itself says, where it has an identity API to ask. */
  identity?: {
    status: string
    detail?: string | null
    external?: { url: string; label: string } | null
  }
}

export interface CreateDomainRequest {
  name: string
  region?: string
  custom_return_path?: string
}

export interface UpdateDomainRequest {
  open_tracking?: boolean
  click_tracking?: boolean
  tls?: 'opportunistic' | 'enforced'
}

export interface DomainQuota {
  daily_quota: number | null
  used_today: number
  remaining: number | null
  resets_at: string
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export type ApiKeyPermission = 'full_access' | 'sending_access'

export interface CreateApiKeyRequest {
  name: string
  permission?: ApiKeyPermission
  /** Scope a sending key to one domain. */
  domain_id?: string
  /** Keys that expire are the difference between a leak and an incident. */
  expires_at?: string
}

export interface ApiKey {
  object: 'api_key'
  id: string
  name: string
  created_at: string
  permission?: ApiKeyPermission
  /** `ms_live_a1b2…` — a preview only. The secret is shown exactly once. */
  token_preview?: string
  last_used_at?: string | null
  expires_at?: string | null
}

export interface CreatedApiKey {
  object: 'api_key'
  id: string
  /** Present only in the create response. Never retrievable again. */
  token: string
}

// ---------------------------------------------------------------------------
// Audiences & contacts
// ---------------------------------------------------------------------------

export interface Audience {
  object: 'audience'
  id: string
  name: string
  created_at: string
  contact_count?: number
}

export interface CreateAudienceRequest {
  name: string
}

export interface UpdateAudienceRequest {
  name?: string
}

export interface Contact {
  object: 'contact'
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  created_at: string
  unsubscribed: boolean
  audience_id?: string
  data?: Record<string, unknown> | null
  last_open_at?: string | null
  last_click_at?: string | null
  open_count?: number
  click_count?: number
}

export interface CreateContactRequest {
  email: EmailAddress
  first_name?: string
  last_name?: string
  unsubscribed?: boolean
  audience_id?: string
  data?: Record<string, unknown>
}

export type UpdateContactRequest = Omit<Partial<CreateContactRequest>, 'audience_id'>

export interface ImportContactsRequest {
  audience_id: string
  contacts: CreateContactRequest[]
  /** Update rather than reject a contact that already exists in the audience. */
  upsert?: boolean
}

export interface ImportContactsResponse {
  object: 'import'
  imported: number
  updated: number
  skipped: number
  errors?: { index: number; message: string }[]
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export interface Segment {
  object: 'segment'
  id: string
  name: string
  audience_id: string
  /** The DSL source, e.g. `opened_last_30d and not clicked_last_30d`. */
  expression: string
  created_at: string
  updated_at: string
  member_count?: number
  computed_at?: string | null
}

export interface CreateSegmentRequest {
  name: string
  audience_id: string
  expression: string
}

export interface UpdateSegmentRequest {
  name?: string
  expression?: string
}

export interface PreviewSegmentRequest {
  audience_id: string
  expression: string
  limit?: number
}

export interface PreviewSegmentResponse {
  count: number
  sample: Contact[]
  /** Rendered English for the expression, so the UI never has to parse it again. */
  description?: string
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export type TemplateEngine = 'handlebars' | 'mjml' | 'jsx-ast' | 'html'

export interface Template {
  object: 'template'
  id: string
  name: string
  slug: string
  engine: TemplateEngine
  subject: string | null
  version: number
  created_at: string
  updated_at: string
  variables?: string[]
}

export interface CreateTemplateRequest {
  name: string
  slug?: string
  engine?: TemplateEngine
  subject?: string
  html?: string
  text?: string
  /** Data-only AST produced by `mailysend templates push` from JSX. */
  ast?: unknown
}

export type UpdateTemplateRequest = Partial<CreateTemplateRequest>

export interface TemplateVersion {
  object: 'template_version'
  id: string
  template_id: string
  version: number
  subject: string | null
  html: string | null
  text: string | null
  variables?: string[]
  created_at: string
}

export interface CreateTemplateVersionRequest {
  subject?: string
  html?: string
  text?: string
  ast?: unknown
  /** Publish the new version immediately instead of leaving it as a draft. */
  publish?: boolean
}

export interface PreviewTemplateRequest {
  data?: Record<string, unknown>
  version?: number
}

export interface PreviewTemplateResponse {
  subject: string | null
  html: string
  text: string
  warnings?: { code: string; message: string; detail?: string }[]
}

export interface TestTemplateRequest {
  to: EmailAddressList
  from?: EmailAddress
  data?: Record<string, unknown>
  version?: number
}

export interface RollbackTemplateRequest {
  version: number
}

// ---------------------------------------------------------------------------
// Broadcasts
// ---------------------------------------------------------------------------

export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'canceled'

export interface BroadcastVariant {
  key: string
  subject: string
  html?: string
  text?: string
  /** Percentage of the test cohort. Must sum to 100 across variants. */
  weight: number
}

export interface BroadcastStats {
  total: number
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  complained: number
  unsubscribed: number
}

export interface Broadcast {
  object: 'broadcast'
  id: string
  name: string | null
  audience_id: string | null
  segment_id?: string | null
  from: string | null
  subject: string | null
  reply_to: string[] | null
  preview_text?: string | null
  status: BroadcastStatus
  created_at: string
  scheduled_at: string | null
  sent_at: string | null
  /** Messages per minute. The coordinator mints tokens at this rate. */
  throttle_per_minute?: number | null
  variants?: BroadcastVariant[]
  /** Fraction held back from the A/B test until a winner is chosen. */
  holdout_percent?: number | null
  /** Null on a broadcast with no A/B test, which is most of them. */
  winner_metric?: 'opens' | 'clicks' | null
  /** The variant key that won, once the winner alarm has run. */
  winner_variant?: string | null
  /** True when the test ran and the difference did not reach significance. */
  ab_inconclusive?: boolean
  /** Known once the recipient set has been counted, not before. */
  total_recipients?: number | null
  stats?: BroadcastStats
}

export interface CreateBroadcastRequest {
  name?: string
  audience_id: string
  segment_id?: string
  from: EmailAddress
  subject: string
  reply_to?: EmailAddress | EmailAddress[]
  preview_text?: string
  html?: string
  text?: string
  template_id?: string
  throttle_per_minute?: number
  variants?: BroadcastVariant[]
  holdout_percent?: number
  winner_metric?: 'opens' | 'clicks'
}

export type UpdateBroadcastRequest = Partial<CreateBroadcastRequest>

export interface SendBroadcastRequest {
  scheduled_at?: string
}

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

export type AutomationTrigger =
  | { type: 'contact_created'; audience_id: string }
  | { type: 'segment_entered'; segment_id: string }
  | { type: 'segment_exited'; segment_id: string }
  | { type: 'event'; name: string }
  | { type: 'api'; name: string }
  | { type: 'schedule'; cron: string }

export type AutomationStep =
  | {
      type: 'send'
      template_id?: string
      subject?: string
      html?: string
      text?: string
      from?: EmailAddress
    }
  | { type: 'wait'; duration: string }
  | { type: 'wait_until'; event: string; timeout: string }
  | { type: 'branch'; condition: string; then: unknown[]; otherwise?: unknown[] }
  | { type: 'tag'; add?: string[]; remove?: string[] }
  | { type: 'webhook'; url: string }
  | { type: 'exit' }

/**
 * `cohort` is the default at audience scale: Workflows V2 caps 50,000
 * concurrent instances, so one instance per contact is impossible past ~40k.
 */
export type AutomationMode = 'cohort' | 'instance'

export interface Automation {
  object: 'automation'
  id: string
  name: string
  status: 'draft' | 'active' | 'paused' | 'archived'
  mode: AutomationMode
  trigger: AutomationTrigger
  steps: AutomationStep[]
  version: number
  created_at: string
  enrolled_count?: number
}

export interface CreateAutomationRequest {
  name: string
  trigger: AutomationTrigger
  steps: AutomationStep[]
  mode?: AutomationMode
}

export type UpdateAutomationRequest = Partial<CreateAutomationRequest>

export interface AutomationEnrollment {
  object: 'automation_enrollment'
  id: string
  automation_id: string
  contact_id: string
  version: number
  status: 'active' | 'completed' | 'canceled' | 'failed'
  current_step: number
  cohort?: string | null
  instance_id?: string | null
  created_at: string
  completed_at?: string | null
}

export interface EnrollContactsRequest {
  contact_ids?: string[]
  segment_id?: string
  audience_id?: string
}

export interface AutomationStats {
  enrolled: number
  active: number
  completed: number
  by_step: { step: number; type: string; entered: number; completed: number }[]
}

// ---------------------------------------------------------------------------
// Suppressions
// ---------------------------------------------------------------------------

export type SuppressionReason = 'hard_bounce' | 'complaint' | 'unsubscribe' | 'manual' | 'provider'

export interface Suppression {
  object: 'suppression'
  email: string
  reason: SuppressionReason
  created_at: string
  source?: string | null
  /** Soft-bounce suppressions expire; hard bounces do not. */
  expires_at?: string | null
}

export interface CreateSuppressionRequest {
  email: EmailAddress
  reason?: SuppressionReason
  expires_at?: string
}

export interface BulkSuppressionRequest {
  suppressions: CreateSuppressionRequest[]
}

export interface BulkSuppressionResponse {
  object: 'list'
  created: number
  skipped: number
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export type WebhookEventName =
  | 'email.sent'
  | 'email.delivered'
  | 'email.delivery_delayed'
  | 'email.bounced'
  | 'email.complained'
  | 'email.opened'
  | 'email.clicked'
  | 'email.failed'
  | 'contact.created'
  | 'contact.updated'
  | 'contact.deleted'
  | 'contact.unsubscribed'
  | 'broadcast.sent'
  | 'broadcast.completed'
  | 'broadcast.ab_winner'
  | 'broadcast.ab_inconclusive'
  | 'domain.verified'
  | 'domain.failed'
  | 'inbound.received'
  | 'inbound.replied'

export interface Webhook {
  object: 'webhook'
  id: string
  url: string
  events: WebhookEventName[]
  status: 'enabled' | 'disabled'
  created_at: string
  /** Shown once at creation; used to verify `MailySend-Signature`. */
  secret?: string
  consecutive_failures?: number
}

export interface CreateWebhookRequest {
  url: string
  events: WebhookEventName[]
  description?: string
}

export interface UpdateWebhookRequest {
  url?: string
  events?: WebhookEventName[]
  status?: 'enabled' | 'disabled'
  description?: string
}

export interface WebhookDelivery {
  object: 'webhook_delivery'
  id: string
  endpoint_id: string
  event_id: string
  status: 'pending' | 'delivered' | 'failed'
  response_status?: number | null
  attempts: number
  created_at: string
  delivered_at?: string | null
  error?: string | null
}

/** The body POSTed to customer webhook endpoints. */
export interface WebhookPayload {
  type: string
  created_at: string
  data: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export type AudienceClass = 'human' | 'all' | 'bot' | 'mpp' | 'scanner' | 'proxy_prefetch'

export interface StatsQuery {
  from?: string
  to?: string
  granularity?: 'hour' | 'day' | 'week' | 'month'
  domain_id?: string
  tag?: string
  provider?: string
  /** Open/click charts default to `human`; the others are kept and selectable. */
  audience_class?: AudienceClass
}

export interface AnalyticsOverview {
  sent: number
  delivered: number
  bounced: number
  complained: number
  opened: number
  clicked: number
  unsubscribed: number
  delivery_rate: number
  open_rate: number
  click_rate: number
  bounce_rate: number
  complaint_rate: number
}

export interface TimeseriesPoint {
  bucket: string
  sent: number
  delivered: number
  bounced: number
  complained: number
  opened: number
  clicked: number
}

export interface AnalyticsBreakdownRow {
  key: string
  sent: number
  delivered: number
  bounced: number
  opened: number
  clicked: number
}

export interface EngagementBreakdown {
  audience_class: AudienceClass
  opens: number
  clicks: number
}

export type MetricSource = 'seed' | 'postmaster' | 'snds' | 'estimate'

/**
 * Every placement figure carries where it came from. `250 OK` from an MTA means
 * *accepted*, not *inboxed*.
 */
export interface PlacementFigure {
  provider: string
  inbox_percent: number
  spam_percent: number
  missing_percent: number
  source: MetricSource
  confidence: 'high' | 'medium' | 'low'
  sample_size: number | null
  measured_at: string
}

export interface CreatePlacementTestRequest {
  domain_id?: string
  from?: EmailAddress
  subject?: string
  html?: string
  text?: string
}

export interface PlacementTest {
  object: 'placement_test'
  id: string
  status: 'pending' | 'running' | 'complete' | 'failed'
  created_at: string
  completed_at?: string | null
  results?: PlacementFigure[]
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

export interface InboundThread {
  object: 'inbound_thread'
  id: string
  subject: string
  participants: string[]
  message_count: number
  last_message_at: string
  unread: boolean
  /** How the message was attached to this thread, in descending confidence. */
  matched_by?: 'reply_token' | 'in_reply_to' | 'references' | 'subject_participants' | 'new'
}

export interface InboundAttachment {
  filename: string
  content_type: string
  size: number
  url: string
}

export interface InboundMessage {
  object: 'inbound_message'
  id: string
  thread_id: string
  from: string
  to: string[]
  subject: string
  received_at: string
  snippet: string
  html?: string | null
  text?: string | null
  attachments?: InboundAttachment[]
  spf?: 'pass' | 'fail' | 'softfail' | 'neutral' | 'none'
  dkim?: 'pass' | 'fail' | 'none'
  dmarc?: 'pass' | 'fail' | 'none'
  /** `raw_only` when MIME parsing failed — the message is kept, never dropped. */
  parse_status: 'parsed' | 'raw_only'
}

export interface InboundThreadDetail extends InboundThread {
  messages: InboundMessage[]
}

export interface ReplyToThreadRequest {
  html?: string
  text?: string
  from?: EmailAddress
  subject?: string
  attachments?: Attachment[]
}

export interface ListThreadsParams extends PaginationParams {
  unread?: boolean
  q?: string
}
