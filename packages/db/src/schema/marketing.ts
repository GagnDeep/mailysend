import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { bool, createdAt, json, updatedAt, workspaceId } from './_shared.ts'

export const audiences = sqliteTable(
  'audiences',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    name: text('name').notNull(),
    contactCount: integer('contact_count').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('audiences_ws').on(t.workspaceId, t.createdAt)],
)

/**
 * Contacts.
 *
 * The engagement columns at the bottom are denormalised on purpose. They are
 * maintained by the event consumer so that a segment predicate like
 * `opened_last_30d` compiles to an indexed comparison on this table rather than
 * a join against `message_events` — which is the difference between segments
 * that recompute continuously and segments that recompute nightly.
 */
export const contacts = sqliteTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    audienceId: text('audience_id').notNull(),
    email: text('email').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    unsubscribed: bool('unsubscribed').notNull().default(false),
    unsubscribedAt: text('unsubscribed_at'),
    /** Arbitrary merge fields. Keys used in a segment get an expression index. */
    data: json('data'),

    lastOpenAt: text('last_open_at'),
    lastClickAt: text('last_click_at'),
    lastSendAt: text('last_send_at'),
    openCount: integer('open_count').notNull().default(0),
    clickCount: integer('click_count').notNull().default(0),
    sendCount: integer('send_count').notNull().default(0),
    bounceCount: integer('bounce_count').notNull().default(0),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('contacts_audience_email').on(t.workspaceId, t.audienceId, t.email),
    index('contacts_ws_id').on(t.workspaceId, t.id),
    index('contacts_engagement').on(t.workspaceId, t.audienceId, t.lastOpenAt),
    index('contacts_email').on(t.workspaceId, t.email),
  ],
)

/**
 * The delta queue for segment recomputation.
 *
 * Writes mark a contact dirty; a consumer re-evaluates only the segments that
 * reference the changed fields. That covers everything except predicates that
 * flip with the passage of time alone (`last_open < 30d`), which is what the
 * hourly boundary sweep in SegmentDO exists for.
 */
export const contactDirty = sqliteTable(
  'contact_dirty',
  {
    workspaceId: workspaceId(),
    contactId: text('contact_id').notNull(),
    fields: text('fields').notNull(),
    markedAt: createdAt(),
  },
  (t) => [uniqueIndex('contact_dirty_pk').on(t.workspaceId, t.contactId)],
)

/** Discovered custom field keys, so the segment builder can offer real options. */
export const contactFields = sqliteTable(
  'contact_fields',
  {
    workspaceId: workspaceId(),
    audienceId: text('audience_id').notNull(),
    key: text('key').notNull(),
    type: text('type', { enum: ['string', 'number', 'boolean', 'date'] }).notNull(),
    usageCount: integer('usage_count').notNull().default(0),
    /** An expression index is created on the second use, not the first. */
    indexed: bool('indexed').notNull().default(false),
  },
  (t) => [uniqueIndex('contact_fields_pk').on(t.workspaceId, t.audienceId, t.key)],
)

export const segments = sqliteTable(
  'segments',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    audienceId: text('audience_id').notNull(),
    name: text('name').notNull(),
    /** DSL source. Compiled to parameterised SQL; never interpolated. */
    expression: text('expression').notNull(),
    /** The compiled WHERE fragment plus its bound parameters, cached. */
    compiled: json('compiled'),
    /** Which contact fields the expression reads — drives delta recomputation. */
    dependsOn: json('depends_on'),
    memberCount: integer('member_count').notNull().default(0),
    computedAt: text('computed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('segments_ws').on(t.workspaceId, t.audienceId)],
)

export const segmentMembers = sqliteTable(
  'segment_members',
  {
    workspaceId: workspaceId(),
    segmentId: text('segment_id').notNull(),
    contactId: text('contact_id').notNull(),
    addedAt: createdAt(),
  },
  (t) => [
    uniqueIndex('segment_members_pk').on(t.workspaceId, t.segmentId, t.contactId),
    index('segment_members_contact').on(t.workspaceId, t.contactId),
  ],
)

export const templates = sqliteTable(
  'templates',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    engine: text('engine', { enum: ['handlebars', 'mjml', 'jsx-ast', 'html'] })
      .notNull()
      .default('handlebars'),
    currentVersion: integer('current_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('templates_slug').on(t.workspaceId, t.slug)],
)

/** Every publish is a new row, which is what makes rollback a pointer move. */
export const templateVersions = sqliteTable(
  'template_versions',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    templateId: text('template_id').notNull(),
    version: integer('version').notNull(),
    subject: text('subject'),
    html: text('html'),
    text: text('text'),
    /** Data-only AST for the `jsx-ast` engine. Interpreted, never evaluated. */
    ast: json('ast'),
    variables: json('variables'),
    createdBy: text('created_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('template_versions_pk').on(t.workspaceId, t.templateId, t.version)],
)

export const broadcasts = sqliteTable(
  'broadcasts',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    name: text('name'),
    audienceId: text('audience_id'),
    segmentId: text('segment_id'),
    fromAddress: text('from_address'),
    replyTo: json('reply_to'),
    subject: text('subject'),
    previewText: text('preview_text'),
    templateId: text('template_id'),
    status: text('status', {
      enum: ['draft', 'scheduled', 'sending', 'paused', 'sent', 'canceled'],
    })
      .notNull()
      .default('draft'),
    /** The coordinator mints `throttle/12` tokens every 5 seconds. */
    throttlePerMinute: integer('throttle_per_minute'),
    holdoutPercent: integer('holdout_percent').notNull().default(0),
    winnerMetric: text('winner_metric'),
    winnerVariant: text('winner_variant'),
    /** Set when the z-test could not separate the variants — we say so, rather than pick. */
    winnerInconclusive: bool('winner_inconclusive'),
    totalRecipients: integer('total_recipients').notNull().default(0),
    scheduledAt: text('scheduled_at'),
    startedAt: text('started_at'),
    sentAt: text('sent_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('broadcasts_ws').on(t.workspaceId, t.createdAt),
    index('broadcasts_status').on(t.status, t.scheduledAt),
  ],
)

export const broadcastVariants = sqliteTable(
  'broadcast_variants',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    broadcastId: text('broadcast_id').notNull(),
    key: text('key').notNull(),
    subject: text('subject'),
    html: text('html'),
    text: text('text'),
    weight: integer('weight').notNull().default(50),
    sent: integer('sent').notNull().default(0),
    opened: integer('opened').notNull().default(0),
    clicked: integer('clicked').notNull().default(0),
  },
  (t) => [uniqueIndex('broadcast_variants_pk').on(t.workspaceId, t.broadcastId, t.key)],
)

/**
 * One row per (broadcast, contact). The primary key is the duplicate guard:
 * page workers write with `INSERT OR IGNORE`, so re-enumerating a range after a
 * crash cannot send the same contact twice.
 */
export const broadcastSends = sqliteTable(
  'broadcast_sends',
  {
    workspaceId: workspaceId(),
    broadcastId: text('broadcast_id').notNull(),
    contactId: text('contact_id').notNull(),
    messageId: text('message_id'),
    variant: text('variant'),
    /** Held back from the A/B test until a winner is promoted. */
    holdout: bool('holdout').notNull().default(false),
    sentAt: createdAt(),
  },
  (t) => [
    uniqueIndex('broadcast_sends_pk').on(t.workspaceId, t.broadcastId, t.contactId),
    index('broadcast_sends_msg').on(t.messageId),
  ],
)

export const automations = sqliteTable(
  'automations',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    name: text('name').notNull(),
    status: text('status', { enum: ['draft', 'active', 'paused', 'archived'] })
      .notNull()
      .default('draft'),
    /**
     * `cohort` is the default. Workflows V2 caps 50,000 concurrent instances, so
     * one instance per contact is simply not available past ~40k enrollments —
     * cohort mode runs one instance per (version, hourly cohort ≤ 25,000).
     */
    mode: text('mode', { enum: ['cohort', 'instance'] })
      .notNull()
      .default('cohort'),
    currentVersion: integer('current_version').notNull().default(1),
    enrolledCount: integer('enrolled_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('automations_ws').on(t.workspaceId, t.status)],
)

/**
 * Editing an active automation creates a new version rather than mutating the
 * old one: Workflows replay by positional step id, so reordering steps under a
 * running instance would corrupt it.
 */
export const automationVersions = sqliteTable(
  'automation_versions',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    automationId: text('automation_id').notNull(),
    version: integer('version').notNull(),
    steps: json('steps').notNull(),
    publishedAt: text('published_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('automation_versions_pk').on(t.workspaceId, t.automationId, t.version)],
)

export const automationTriggers = sqliteTable(
  'automation_triggers',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    automationId: text('automation_id').notNull(),
    type: text('type').notNull(),
    config: json('config').notNull(),
  },
  (t) => [index('automation_triggers_lookup').on(t.workspaceId, t.type)],
)

export const automationEnrollments = sqliteTable(
  'automation_enrollments',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    automationId: text('automation_id').notNull(),
    version: integer('version').notNull(),
    contactId: text('contact_id').notNull(),
    /** Null in cohort mode, where a cohort — not a contact — owns the instance. */
    instanceId: text('instance_id'),
    cohort: text('cohort'),
    status: text('status', { enum: ['active', 'completed', 'exited', 'failed'] })
      .notNull()
      .default('active'),
    currentStep: integer('current_step').notNull().default(0),
    enteredAt: createdAt(),
    completedAt: text('completed_at'),
  },
  (t) => [
    // Re-enrolment guard: one active enrolment per (automation, contact).
    uniqueIndex('automation_enrollments_unique').on(t.workspaceId, t.automationId, t.contactId),
    index('automation_enrollments_cohort').on(t.workspaceId, t.automationId, t.cohort, t.status),
  ],
)

export const webhookEndpoints = sqliteTable(
  'webhook_endpoints',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    url: text('url').notNull(),
    events: json('events').notNull(),
    secret: text('secret').notNull(),
    status: text('status', { enum: ['enabled', 'disabled'] })
      .notNull()
      .default('enabled'),
    description: text('description'),
    /** Auto-disabled at 20. A permanently broken endpoint is a retry amplifier. */
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    disabledAt: text('disabled_at'),
    createdAt: createdAt(),
  },
  (t) => [index('webhook_endpoints_ws').on(t.workspaceId, t.status)],
)

/** Every attempt, with its response, because "did my webhook fire?" is the
 *  single most common support question an ESP receives. */
export const webhookDeliveries = sqliteTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    endpointId: text('endpoint_id').notNull(),
    /** Stable across replays; a replay gets a new delivery id, same event id. */
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    attempt: integer('attempt').notNull().default(1),
    status: text('status', { enum: ['pending', 'succeeded', 'failed'] })
      .notNull()
      .default('pending'),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    durationMs: integer('duration_ms'),
    createdAt: createdAt(),
  },
  (t) => [
    index('webhook_deliveries_endpoint').on(t.workspaceId, t.endpointId, t.createdAt),
    index('webhook_deliveries_event').on(t.workspaceId, t.eventId),
  ],
)

export const inboundMailboxes = sqliteTable(
  'inbound_mailboxes',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    address: text('address').notNull(),
    name: text('name'),
    /** Forward parsed mail to a webhook, an agent, or neither. */
    forwardWebhookId: text('forward_webhook_id'),
    agentEnabled: bool('agent_enabled').notNull().default(false),
    /**
     * Accept every address on this mailbox's domain, not just its own.
     *
     * The catch-all an operator binds in Cloudflare Email Routing delivers the
     * whole domain to this Worker; without this the handler still rejected
     * every address it had no exact row for, which is not what "catch-all"
     * means to the person who just turned it on.
     */
    isCatchAll: bool('is_catch_all').notNull().default(false),
    /** Denormalised from `address`, so the catch-all lookup is one index hit. */
    domain: text('domain'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('inbound_mailboxes_address').on(t.workspaceId, t.address),
    // At most one catch-all per domain: two would make delivery depend on row
    // order, which is a coin toss dressed up as configuration.
    uniqueIndex('inbound_mailboxes_catch_all')
      .on(t.workspaceId, t.domain)
      .where(sql`"is_catch_all" = 1`),
  ],
)

export const inboundThreads = sqliteTable(
  'inbound_threads',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    mailboxId: text('mailbox_id').notNull(),
    subject: text('subject').notNull(),
    /** Normalised (Re:/Fwd: stripped, whitespace collapsed) for the fallback match. */
    subjectNormalized: text('subject_normalized').notNull(),
    participants: json('participants').notNull(),
    messageCount: integer('message_count').notNull().default(0),
    unread: bool('unread').notNull().default(true),
    lastMessageAt: text('last_message_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('inbound_threads_mailbox').on(t.workspaceId, t.mailboxId, t.lastMessageAt),
    index('inbound_threads_subject').on(t.workspaceId, t.subjectNormalized, t.lastMessageAt),
  ],
)

export const inboundMessages = sqliteTable(
  'inbound_messages',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceId(),
    threadId: text('thread_id').notNull(),
    mailboxId: text('mailbox_id').notNull(),
    messageIdHeader: text('message_id_header'),
    inReplyTo: text('in_reply_to'),
    fromAddress: text('from_address').notNull(),
    toAddresses: json('to_addresses').notNull(),
    subject: text('subject').notNull(),
    snippet: text('snippet').notNull(),
    rawKey: text('raw_key').notNull(),
    bodyKey: text('body_key'),
    spf: text('spf'),
    dkim: text('dkim'),
    dmarc: text('dmarc'),
    spamScore: integer('spam_score'),
    /** `raw_only` when MIME parsing failed. The mail is kept either way. */
    parseStatus: text('parse_status', { enum: ['parsed', 'raw_only'] })
      .notNull()
      .default('parsed'),
    /** How threading resolved it, in descending confidence. Surfaced in the UI. */
    matchedBy: text('matched_by'),
    receivedAt: text('received_at').notNull(),
  },
  (t) => [
    index('inbound_messages_thread').on(t.workspaceId, t.threadId, t.receivedAt),
    uniqueIndex('inbound_messages_dedupe').on(t.workspaceId, t.rawKey),
  ],
)
