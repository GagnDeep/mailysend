import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { bool, createdAt, json, updatedAt, workspaceId } from './_shared.ts'

export const domains = sqliteTable(
  'domains',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    name: text('name').notNull(),
    status: text('status', {
      enum: ['not_started', 'pending', 'verified', 'failed', 'temporary_failure'],
    })
      .notNull()
      .default('not_started'),
    region: text('region').notNull().default('global'),
    /**
     * The transport this domain sends through. Null means "whatever the
     * workspace's router picks".
     *
     * It exists because DNS requirements were computed as the *union* across
     * every provider the router could yield, and a union of two transports that
     * both want an apex `v=spf1` record is two apex SPF records — which is a
     * hard fail at every receiver that checks. Records derive from one
     * transport, or from a merge that is a single legal record.
     */
    provider: text('provider', { enum: ['cloudflare', 'ses', 'resend', 'smtp'] }),
    /** The DKIM selector we publish. `ms1` unless the customer already uses it. */
    dkimSelector: text('dkim_selector').notNull().default('ms1'),
    dkimPrivateKey: text('dkim_private_key'),
    dkimPublicKey: text('dkim_public_key'),
    /** Cloudflare's sending DNS lives under this subdomain. */
    customReturnPath: text('custom_return_path').notNull().default('cf-bounce'),
    /**
     * Both tracking switches default off, and that is a deliberate reversal.
     *
     * Neither is silent and neither is required to send: open tracking inserts
     * a 1x1 pixel the recipient's client fetches from us, and click tracking
     * rewrites every link so the URL on hover is ours rather than the sender's.
     * Defaulting them on meant a domain added in thirty seconds started
     * altering the sender's mail in ways their recipients can see, before
     * anybody had been asked. A default that a reader would be surprised by if
     * they found out about it later is the wrong default; both are one switch
     * away on the domain page for anyone who wants the data.
     *
     * Existing domains keep whatever they have — the migration rebuilds the
     * table to change the default for new rows and copies every value across.
     */
    openTracking: bool('open_tracking').notNull().default(false),
    clickTracking: bool('click_tracking').notNull().default(false),
    tls: text('tls', { enum: ['opportunistic', 'enforced'] })
      .notNull()
      .default('opportunistic'),
    dmarcPolicy: text('dmarc_policy'),
    /**
     * The last MX observation, memoised so a page load can say something about
     * receiving without resolving anything.
     *
     * Named `mx` and not `receiving` on purpose. A verified MX proves mail for
     * this domain reaches Cloudflare Email Routing; it proves nothing about
     * whether Email Routing's catch-all rule is bound to this Worker, which is
     * not readable over Cloudflare's API. There is deliberately no
     * `receiving_ready` column, because there is no observation that would
     * justify setting one.
     *
     * Null is not `pending`: null is "nobody has looked", `pending` is "we
     * looked and the domain publishes no MX at all" — the same distinction
     * `dmarc_policy` already draws.
     */
    receivingMxStatus: text('receiving_mx_status', {
      enum: ['pending', 'verified', 'failed', 'error'],
    }),
    receivingMxFound: text('receiving_mx_found'),
    receivingCheckedAt: text('receiving_checked_at'),
    /**
     * Learned by SendingDomainDO from provider rejections, never assumed.
     * Cloudflare's daily quota ramps with reputation and is not published, so the
     * only honest way to know it is to observe where sends start failing.
     */
    learnedDailyQuota: integer('learned_daily_quota'),
    lastVerifiedAt: text('last_verified_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('domains_ws_name').on(t.workspaceId, t.name),
    index('domains_ws').on(t.workspaceId, t.createdAt),
  ],
)

export const domainDnsRecords = sqliteTable(
  'domain_dns_records',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    domainId: text('domain_id').notNull(),
    record: text('record', { enum: ['TXT', 'MX', 'CNAME'] }).notNull(),
    name: text('name').notNull(),
    value: text('value').notNull(),
    priority: integer('priority'),
    /** Which transport needs it. The setup screen renders the union per provider. */
    provider: text('provider').notNull().default('all'),
    purpose: text('purpose'),
    /**
     * Who publishes it.
     *
     * `copy` is a record the customer publishes. `observe` is one the transport
     * writes itself — Cloudflare's onboarding adds every record for a domain on
     * its account — and printing those beside a copy button invites somebody to
     * paste a conflicting version of a record that is already correct. We check
     * them; we do not ask for them.
     */
    origin: text('origin', { enum: ['copy', 'observe'] })
      .notNull()
      .default('copy'),
    /**
     * How the resolved value is compared. `exact` is the default; `include` is
     * SPF, where merging our include into an existing record is the right
     * answer; `prefix` is a value only the provider knows, such as the DKIM key
     * Cloudflare mints, where all we can check is that one is there.
     */
    matchMode: text('match_mode', { enum: ['exact', 'include', 'prefix'] })
      .notNull()
      .default('exact'),
    status: text('status').notNull().default('not_started'),
    /** What resolved at this name last time we looked, verbatim. */
    found: text('found'),
    /**
     * Why the last lookup could not be made — a resolver outage, or the zone's
     * own nameservers failing. Stored beside `status = 'error'` so a domain can
     * say "could not be checked" instead of quietly reporting the previous pass.
     */
    error: text('error'),
    lastCheckedAt: text('last_checked_at'),
    /**
     * Set only when *we* wrote the record through an API token. It is what
     * makes automation reversible: a record this product created can be
     * corrected or removed, and one the operator published by hand is theirs.
     */
    zoneId: text('zone_id'),
    managedAt: text('managed_at'),
  },
  (t) => [index('domain_dns_domain').on(t.workspaceId, t.domainId)],
)

/**
 * The message index.
 *
 * Deliberately narrow: bodies live in R2, not here. At ~5–9 writes per email
 * this table is the dominant cost driver at volume, which is why `EVENT_DETAIL`
 * can be turned off to reconstruct timelines from the R2 archive instead.
 */
export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    domainId: text('domain_id'),
    fromAddress: text('from_address').notNull(),
    toAddresses: json('to_addresses').notNull(),
    ccAddresses: json('cc_addresses'),
    bccAddresses: json('bcc_addresses'),
    replyTo: json('reply_to'),
    subject: text('subject').notNull(),

    status: text('status').notNull().default('queued'),
    /**
     * The monotonic ladder. Every status update is `WHERE state_rank < ?`, which
     * turns out-of-order and duplicate provider events into no-ops and removes
     * the need for any ordering guarantee in the event pipeline.
     */
    stateRank: integer('state_rank').notNull().default(10),

    provider: text('provider'),
    /** Recorded for support and DSN correlation. Never the message's identity. */
    providerMessageId: text('provider_message_id'),

    environment: text('environment', { enum: ['live', 'test'] })
      .notNull()
      .default('live'),
    broadcastId: text('broadcast_id'),
    automationId: text('automation_id'),
    contactId: text('contact_id'),
    templateId: text('template_id'),

    scheduledAt: text('scheduled_at'),
    sentAt: text('sent_at'),
    deliveredAt: text('delivered_at'),
    /** Denormalised counters so the log list needs no per-row aggregate. */
    openCount: integer('open_count').notNull().default(0),
    clickCount: integer('click_count').notNull().default(0),

    bounceClass: text('bounce_class'),
    smtpCode: text('smtp_code'),
    smtpResponse: text('smtp_response'),
    errorMessage: text('error_message'),

    sizeBytes: integer('size_bytes'),
    /** Set once the consumer claims the message; the conditional lease against redelivery. */
    leaseUntil: integer('lease_until'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    // Every list query is workspace-scoped and time-ordered, and `id` is a ULID,
    // so this one index serves the log list, its cursor pagination and its
    // date-range filter without a separate created_at index.
    index('messages_ws_id').on(t.workspaceId, t.id),
    index('messages_ws_status').on(t.workspaceId, t.status, t.id),
    index('messages_ws_domain').on(t.workspaceId, t.domainId, t.id),
    index('messages_broadcast').on(t.workspaceId, t.broadcastId, t.id),
    index('messages_contact').on(t.workspaceId, t.contactId, t.id),
    index('messages_provider_msg').on(t.providerMessageId),
    index('messages_scheduled').on(t.status, t.scheduledAt),
  ],
)

export const messageTags = sqliteTable(
  'message_tags',
  {
    workspaceId: workspaceId(),
    messageId: text('message_id').notNull(),
    name: text('name').notNull(),
    value: text('value').notNull(),
  },
  (t) => [
    index('message_tags_lookup').on(t.workspaceId, t.name, t.value, t.messageId),
    index('message_tags_msg').on(t.messageId),
  ],
)

/**
 * Individual events. Written in the same `db.batch()` as the status update, so
 * 100 provider events become roughly six statements rather than six hundred.
 */
export const messageEvents = sqliteTable(
  'message_events',
  {
    /** `sha256(provider|provider_message_id|type|recipient|second)` — deterministic. */
    eventId: text('event_id').primaryKey(),
    workspaceId: workspaceId(),
    messageId: text('message_id'),
    type: text('type').notNull(),
    recipient: text('recipient').notNull(),
    occurredAt: text('occurred_at').notNull(),
    provider: text('provider'),
    /** Present on opens and clicks: human | mpp | proxy_prefetch | scanner | bot. */
    audienceClass: text('audience_class'),
    linkUrl: text('link_url'),
    bounceClass: text('bounce_class'),
    smtpCode: text('smtp_code'),
    smtpResponse: text('smtp_response'),
    /**
     * The provider's own words about a failure — an SMTP transcript line, an API
     * error body, or the message of the exception that ended the send. Without
     * it a failed message's timeline says only "failed", which is the state the
     * reader could already see.
     */
    diagnostic: text('diagnostic'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    geoCountry: text('geo_country'),
    createdAt: createdAt(),
  },
  (t) => [
    index('message_events_msg').on(t.workspaceId, t.messageId, t.occurredAt),
    index('message_events_ws_type').on(t.workspaceId, t.type, t.occurredAt),
  ],
)

/** One row per tracked link per message, created at render time. */
export const messageLinks = sqliteTable(
  'message_links',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    messageId: text('message_id'),
    broadcastId: text('broadcast_id'),
    url: text('url').notNull(),
    clickCount: integer('click_count').notNull().default(0),
    uniqueClickCount: integer('unique_click_count').notNull().default(0),
  },
  (t) => [
    index('message_links_msg').on(t.workspaceId, t.messageId),
    index('message_links_broadcast').on(t.workspaceId, t.broadcastId, t.clickCount),
  ],
)

/**
 * Suppressions. Also mirrored into KV, because this is read once per recipient
 * on every send and a database round trip there would dominate send latency.
 */
export const suppressions = sqliteTable(
  'suppressions',
  {
    workspaceId: workspaceId(),
    /** Plus-tags stripped and gmail dots removed — see normalizeForSuppression. */
    email: text('email').notNull(),
    originalEmail: text('original_email').notNull(),
    reason: text('reason', {
      enum: ['hard_bounce', 'complaint', 'unsubscribe', 'manual', 'provider'],
    }).notNull(),
    /** Which message or broadcast caused it, so the dashboard can explain itself. */
    source: text('source'),
    /** Soft-bounce suppressions expire; hard bounces and complaints never do. */
    expiresAt: text('expires_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('suppressions_pk').on(t.workspaceId, t.email),
    index('suppressions_ws_created').on(t.workspaceId, t.createdAt),
  ],
)

/**
 * Pre-aggregated counts. These, not Analytics Engine, are the numbers of
 * record: AE samples under load and retains only three months.
 */
export const rollupsDaily = sqliteTable(
  'rollups_daily',
  {
    workspaceId: workspaceId(),
    day: text('day').notNull(),
    domainId: text('domain_id').notNull().default(''),
    provider: text('provider').notNull().default(''),
    sent: integer('sent').notNull().default(0),
    delivered: integer('delivered').notNull().default(0),
    bounced: integer('bounced').notNull().default(0),
    complained: integer('complained').notNull().default(0),
    opened: integer('opened').notNull().default(0),
    uniqueOpened: integer('unique_opened').notNull().default(0),
    clicked: integer('clicked').notNull().default(0),
    uniqueClicked: integer('unique_clicked').notNull().default(0),
    unsubscribed: integer('unsubscribed').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    delayed: integer('delayed').notNull().default(0),
    /** Opens attributable to Apple MPP, excluded from the privacy-adjusted rate. */
    mppOpened: integer('mpp_opened').notNull().default(0),
    botOpened: integer('bot_opened').notNull().default(0),
  },
  (t) => [uniqueIndex('rollups_daily_pk').on(t.workspaceId, t.day, t.domainId, t.provider)],
)

export const rollupsHourly = sqliteTable(
  'rollups_hourly',
  {
    workspaceId: workspaceId(),
    hour: text('hour').notNull(),
    domainId: text('domain_id').notNull().default(''),
    sent: integer('sent').notNull().default(0),
    delivered: integer('delivered').notNull().default(0),
    bounced: integer('bounced').notNull().default(0),
    opened: integer('opened').notNull().default(0),
    clicked: integer('clicked').notNull().default(0),
    complained: integer('complained').notNull().default(0),
    failed: integer('failed').notNull().default(0),
  },
  (t) => [uniqueIndex('rollups_hourly_pk').on(t.workspaceId, t.hour, t.domainId)],
)

/** Parsed DMARC aggregate reports — the thing almost no ESP surfaces. */
export const dmarcReports = sqliteTable(
  'dmarc_reports',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    domain: text('domain').notNull(),
    orgName: text('org_name').notNull(),
    reportId: text('report_id').notNull(),
    dateBegin: text('date_begin').notNull(),
    dateEnd: text('date_end').notNull(),
    policyP: text('policy_p'),
    totalMessages: integer('total_messages').notNull().default(0),
    passCount: integer('pass_count').notNull().default(0),
    failCount: integer('fail_count').notNull().default(0),
    rawKey: text('raw_key'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('dmarc_reports_unique').on(t.workspaceId, t.orgName, t.reportId),
    index('dmarc_reports_domain').on(t.workspaceId, t.domain, t.dateBegin),
  ],
)

export const dmarcRows = sqliteTable(
  'dmarc_rows',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    reportId: text('report_id').notNull(),
    sourceIp: text('source_ip').notNull(),
    count: integer('count').notNull(),
    disposition: text('disposition'),
    dkimResult: text('dkim_result'),
    spfResult: text('spf_result'),
    headerFrom: text('header_from'),
    /** The domains the receiver actually evaluated; alignment is the comparison
     * of these against `header_from`, so a fail row is unattributable without them. */
    dkimDomain: text('dkim_domain'),
    spfDomain: text('spf_domain'),
    /** Reverse DNS, resolved lazily — this is what turns an IP into "your CRM". */
    sourceLabel: text('source_label'),
  },
  (t) => [index('dmarc_rows_report').on(t.workspaceId, t.reportId)],
)

/**
 * Inbox placement.
 *
 * `source` and `confidence` are NOT NULL on purpose. A placement number without
 * its provenance is a guess wearing a measurement's clothes, and this is the
 * one product area where that would be actively dishonest.
 */
export const placementTests = sqliteTable(
  'placement_tests',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    domainId: text('domain_id'),
    name: text('name'),
    status: text('status', { enum: ['running', 'complete', 'failed'] })
      .notNull()
      .default('running'),
    seedCount: integer('seed_count').notNull().default(0),
    startedAt: createdAt(),
    completedAt: text('completed_at'),
  },
  (t) => [index('placement_tests_ws').on(t.workspaceId, t.startedAt)],
)

export const placementResults = sqliteTable(
  'placement_results',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    testId: text('test_id'),
    domainId: text('domain_id'),
    /** gmail | microsoft | yahoo | apple | … */
    recipientProvider: text('recipient_provider').notNull(),
    inboxPercent: real('inbox_percent').notNull(),
    spamPercent: real('spam_percent').notNull(),
    missingPercent: real('missing_percent').notNull(),
    source: text('source', { enum: ['seed', 'postmaster', 'snds', 'estimate'] }).notNull(),
    confidence: text('confidence', { enum: ['high', 'medium', 'low'] }).notNull(),
    sampleSize: integer('sample_size'),
    measuredAt: text('measured_at').notNull(),
  },
  (t) => [index('placement_results_ws').on(t.workspaceId, t.domainId, t.measuredAt)],
)

export const alerts = sqliteTable(
  'alerts',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    name: text('name').notNull(),
    metric: text('metric').notNull(),
    comparator: text('comparator', { enum: ['gt', 'lt'] }).notNull(),
    threshold: real('threshold').notNull(),
    windowMinutes: integer('window_minutes').notNull().default(60),
    /** Minimum events before the rule can fire — 1 bounce out of 2 is not a 50% rate. */
    minSample: integer('min_sample').notNull().default(50),
    channel: text('channel').notNull(),
    target: text('target').notNull(),
    enabled: bool('enabled').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('alerts_ws').on(t.workspaceId, t.enabled)],
)

export const alertIncidents = sqliteTable(
  'alert_incidents',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    alertId: text('alert_id').notNull(),
    observedValue: real('observed_value').notNull(),
    sampleSize: integer('sample_size').notNull(),
    openedAt: createdAt(),
    resolvedAt: text('resolved_at'),
    notifiedAt: text('notified_at'),
  },
  (t) => [index('alert_incidents_ws').on(t.workspaceId, t.openedAt)],
)
