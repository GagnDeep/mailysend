/**
 * Every durable key in the system is built here.
 *
 * This file exists to make one invariant mechanical rather than remembered:
 * *nothing is ever addressed without its workspace*. Durable Object names, R2
 * paths and KV keys all carry `workspace_id` unconditionally — in single-tenant
 * mode too, where it is always `ws_default`.
 *
 * The payoff is that promoting a self-hosted deployment into a multi-tenant one
 * is a data migration, not a redesign, and that there is no `if (selfHost)`
 * branch anywhere in data-access code waiting to leak one tenant's mail into
 * another's dashboard.
 */

export const DEFAULT_WORKSPACE = 'ws_default'

/** Durable Object / actor names. `kind` matches the class, never abbreviated. */
export const doName = (kind: string, workspaceId: string, ...parts: (string | number)[]): string =>
  [kind, workspaceId, ...parts.map(String)].join(':')

// ---------------------------------------------------------------------------
// R2 / blob keys
// ---------------------------------------------------------------------------

/**
 * In single-tenant mode the workspace segment is elided, so the archive path is
 * literally `events/2026-09/*.parquet` — the shape the docs promise, and the
 * shape a self-hoster expects to find when they open their own bucket.
 */
const ws = (workspaceId: string) => (workspaceId === DEFAULT_WORKSPACE ? '' : `${workspaceId}/`)

export const r2Key = {
  /** The send envelope. Read once by the consumer, expired by lifecycle at 7 days. */
  spool: (workspaceId: string, emailId: string) => `spool/${ws(workspaceId)}${emailId}.json`,
  /** Outbound attachments, content-addressed so the same file is stored once. */
  attachment: (workspaceId: string, sha256: string) => `att/${ws(workspaceId)}${sha256}`,
  /** The exact bytes we handed the provider. The only real answer to "what did you send?". */
  rawOutbound: (workspaceId: string, emailId: string) => `raw/${ws(workspaceId)}${emailId}.eml`,
  /** Raw inbound MIME, written by the email() handler before anything is parsed. */
  rawInbound: (workspaceId: string, inboundId: string) =>
    `rawin/${ws(workspaceId)}${inboundId}.eml`,
  /** Parsed inbound bodies and attachments, addressed by thread as the docs specify. */
  inbound: (workspaceId: string, threadId: string, file: string) =>
    `inb/${ws(workspaceId)}${threadId}/${file}`,
  /** A broadcast's rendered body, fetched once per page worker rather than per contact. */
  broadcastBody: (workspaceId: string, broadcastId: string, variant = 'default') =>
    `bcast/${ws(workspaceId)}${broadcastId}/${variant}.json`,
  /** Compiled template artefacts. */
  template: (workspaceId: string, templateId: string, version: number) =>
    `tpl/${ws(workspaceId)}${templateId}/v${version}.json`,
  /** NDJSON event staging. Compacted into parquet, then expired at 3 days. */
  eventStage: (workspaceId: string, hourIso: string, shard: string) =>
    `stage/${ws(workspaceId)}${hourIso}/${shard}.ndjson`,
  /** The long-term archive. Analytics Engine keeps 3 months; this is the other 6 years, 9 months. */
  eventArchive: (workspaceId: string, month: string, part: string) =>
    `events/${ws(workspaceId)}${month}/${part}.parquet`,
  dmarcReport: (workspaceId: string, reportId: string) => `dmarc/${ws(workspaceId)}${reportId}.xml`,
  /** Customer-requested exports. Served through a signed URL, expired at 7 days. */
  export: (workspaceId: string, exportId: string, file: string) =>
    `exports/${ws(workspaceId)}${exportId}/${file}`,
  /** Dead-lettered queue messages, kept so an incident is debuggable after the fact. */
  deadLetter: (queue: string, id: string) => `dlq/${queue}/${id}.json`,
} as const

// ---------------------------------------------------------------------------
// KV keys
// ---------------------------------------------------------------------------

/**
 * KV is a cache with exactly one exception: suppressions, which are permanent
 * and authoritative-for-reads because they are consulted for every recipient of
 * every send and must not cost a database round trip.
 */
export const kvKey = {
  apiKey: (hash: string) => `ak:${hash}`,
  workspace: (workspaceId: string) => `ws:${workspaceId}`,
  /**
   * The cached value is a row shape, not a scalar, so the key carries a version.
   *
   * Bump it whenever `resolveDomain`'s SELECT changes. Without a bump a rolling
   * deploy keeps serving 300-second-old rows that are missing the column the new
   * code depends on — when `provider` was added, a bound domain kept being
   * routed by hash for five minutes after the deploy, which is exactly the
   * failure the binding exists to prevent. Old keys are never read again and
   * expire on their own TTL.
   */
  domain: (workspaceId: string, domain: string) => `dom:v2:${workspaceId}:${domain.toLowerCase()}`,
  suppression: (workspaceId: string, email: string) => `sup:${workspaceId}:${email.toLowerCase()}`,
  idempotency: (workspaceId: string, key: string) => `idem:${workspaceId}:${key}`,
  compiledTemplate: (workspaceId: string, templateId: string, version: number) =>
    `tplc:${workspaceId}:${templateId}:${version}`,
  /** Maps a short link token back to its destination, written at render time. */
  link: (workspaceId: string, linkId: string) => `lnk:${workspaceId}:${linkId}`,
  /** Read by every in-flight page worker, so pause takes effect within its 5s TTL. */
  broadcastFlag: (workspaceId: string, broadcastId: string) => `bcf:${workspaceId}:${broadcastId}`,
  eventDedupe: (eventId: string) => `evd:${eventId}`,
  /** First open/click per (message, recipient) — the difference between total and unique. */
  uniqueOpen: (emailId: string, recipient: string) => `uo:${emailId}:${recipient}`,
  uniqueClick: (emailId: string, linkId: string, recipient: string) =>
    `uc:${emailId}:${linkId}:${recipient}`,
  botRuleset: () => 'cfg:bot-ruleset',
  rateLimit: (workspaceId: string, window: string) => `rl:${workspaceId}:${window}`,
} as const

export const KV_TTL = {
  /** Long enough to matter under load, short enough that a revoked key dies fast. */
  apiKey: 300,
  workspace: 300,
  domain: 300,
  /** Matches the window in which a client may safely retry the same request. */
  idempotency: 86_400,
  compiledTemplate: 3600,
  /** Links must outlive the campaign: people click year-old newsletters. */
  link: 400 * 86_400,
  /** Short by design — pause must take effect quickly, and the flag is cheap to re-read. */
  broadcastFlag: 5,
  eventDedupe: 7 * 86_400,
  uniqueMarker: 400 * 86_400,
} as const

// ---------------------------------------------------------------------------
// Queue names
// ---------------------------------------------------------------------------

export const QUEUES = {
  send: 'ms-send',
  sendBulk: 'ms-send-bulk',
  eventsCloudflare: 'ms-events-cf',
  eventsRaw: 'ms-events-raw',
  eventsNormalized: 'ms-events-norm',
  webhooks: 'ms-webhooks',
  broadcastPages: 'ms-broadcast-pages',
  inbound: 'ms-inbound',
  segments: 'ms-segments',
  automationTriggers: 'ms-automation-triggers',
  dmarc: 'ms-dmarc',
  export: 'ms-export',
  tracking: 'ms-tracking',
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

export const ANALYTICS_DATASETS = {
  emailEvents: 'ms_email_events',
  tagFacts: 'ms_tag_facts',
  engagement: 'ms_engagement',
  placement: 'ms_placement',
  apiUsage: 'ms_api_usage',
} as const
