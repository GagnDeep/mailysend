import { join } from 'node:path'
import { ANALYTICS_DATASETS, QUEUES } from '@mailysend/core'
import {
  AutomationCohortActor,
  AutomationRunActor,
  BroadcastActor,
  BroadcastCounterActor,
  MailboxActor,
  ScheduleShardActor,
  SegmentActor,
  SendingDomainActor,
  WebhookEndpointActor,
  WorkspaceHubActor,
} from '@mailysend/durable'
import { createNodePlatform } from '@mailysend/platform/node'
import { configure } from './bootstrap.ts'
import { consumeBroadcastPages } from './consumers/broadcast.ts'
import { consumeEventQueue } from './consumers/events.ts'
import { consumeInbound } from './consumers/inbound.ts'
import { consumeMisc } from './consumers/misc.ts'
import { consumeWebhooks } from './consumers/webhooks.ts'
import { runCron } from './cron.ts'
import type { Env } from './env.ts'
import { runWithEnv } from './env.ts'
import { consumeSend } from './send/consumer.ts'

/**
 * The Node runtime.
 *
 * This assembles a binding object whose property names are byte-identical to
 * `wrangler.jsonc`'s, so nothing above `server/` learns which runtime it is on.
 * That is the entire point of `@mailysend/platform`: the seam is here, in one
 * file, rather than smeared across the application as `if (isWorkers)`.
 *
 * The HTTP server itself is TanStack Start's — `node .output/server/server.js`
 * with `PORT=8917`, which is the port the nginx block proxies to. Adding a
 * second listener here would mean two static-asset paths and two shutdown
 * sequences for one process.
 */

const PORT = Number(process.env.PORT ?? 8917)
const DATA_DIR = process.env.MS_DATA_DIR ?? join(process.cwd(), '.data')

const platform = createNodePlatform({
  dataDir: DATA_DIR,
  kvNamespaces: ['cache', 'suppressions'],
  blobBuckets: ['default'],
  analyticsDatasets: Object.values(ANALYTICS_DATASETS),
})

for (const [kind, cls] of [
  ['SendingDomain', SendingDomainActor],
  ['Broadcast', BroadcastActor],
  ['BroadcastCounter', BroadcastCounterActor],
  ['WebhookEndpoint', WebhookEndpointActor],
  ['ScheduleShard', ScheduleShardActor],
  ['Mailbox', MailboxActor],
  ['Segment', SegmentActor],
  ['AutomationCohort', AutomationCohortActor],
  ['AutomationRun', AutomationRunActor],
  ['WorkspaceHub', WorkspaceHubActor],
] as const) {
  platform.actors.register(kind, cls as never)
}

const env: Env = {
  MS_MODE: (process.env.MS_MODE as 'single' | 'saas') ?? 'single',
  // Resolved properly by `configure()` from the mode; this is only the shape
  // the type demands before the first request has been seen.
  MS_LANDING: (process.env.MS_LANDING as 'app' | 'marketing') ?? 'app',
  // Left empty rather than guessed when unset: `configure()` resolves it from
  // the first request's own origin and stores it, which is right far more often
  // than a hardcoded localhost would be behind a proxy or on workers.dev.
  MS_PUBLIC_URL: process.env.MS_PUBLIC_URL ?? '',
  ...(process.env.MS_TRACKING_URL ? { MS_TRACKING_URL: process.env.MS_TRACKING_URL } : {}),
  MS_SECRET: configuredSecret(),
  ...(process.env.MS_DATA_KEY ? { MS_DATA_KEY: process.env.MS_DATA_KEY } : {}),
  ...(process.env.MS_DEFAULT_PROVIDER
    ? { MS_DEFAULT_PROVIDER: process.env.MS_DEFAULT_PROVIDER as Env['MS_DEFAULT_PROVIDER'] }
    : {}),
  ...(process.env.EVENT_DETAIL ? { EVENT_DETAIL: process.env.EVENT_DETAIL as 'on' | 'off' } : {}),
  ...(process.env.MS_OWNER_EMAIL ? { MS_OWNER_EMAIL: process.env.MS_OWNER_EMAIL } : {}),
  ...(process.env.MS_OIDC_ISSUER ? { MS_OIDC_ISSUER: process.env.MS_OIDC_ISSUER } : {}),
  ...(process.env.MS_OIDC_CLIENT_ID ? { MS_OIDC_CLIENT_ID: process.env.MS_OIDC_CLIENT_ID } : {}),
  ...(process.env.MS_OIDC_CLIENT_SECRET
    ? { MS_OIDC_CLIENT_SECRET: process.env.MS_OIDC_CLIENT_SECRET }
    : {}),
  ...(process.env.MS_OIDC_ALLOWED_DOMAINS
    ? { MS_OIDC_ALLOWED_DOMAINS: process.env.MS_OIDC_ALLOWED_DOMAINS }
    : {}),
  ...(process.env.MS_OIDC_AUTO_PROVISION
    ? { MS_OIDC_AUTO_PROVISION: process.env.MS_OIDC_AUTO_PROVISION }
    : {}),
  ...(process.env.MS_OIDC_LABEL ? { MS_OIDC_LABEL: process.env.MS_OIDC_LABEL } : {}),
  ...(process.env.MS_ACCESS_TEAM ? { MS_ACCESS_TEAM: process.env.MS_ACCESS_TEAM } : {}),
  ...(process.env.MS_ACCESS_AUD ? { MS_ACCESS_AUD: process.env.MS_ACCESS_AUD } : {}),

  DB: platform.sql,
  CACHE: platform.kv('cache'),
  SUPPRESSIONS: platform.kv('suppressions'),
  BUCKET: platform.blob('default'),

  SEND_QUEUE: platform.queues.producer(QUEUES.send),
  SEND_BULK_QUEUE: platform.queues.producer(QUEUES.sendBulk),
  EVENTS_QUEUE: platform.queues.producer(QUEUES.eventsNormalized),
  WEBHOOKS_QUEUE: platform.queues.producer(QUEUES.webhooks),
  BROADCAST_QUEUE: platform.queues.producer(QUEUES.broadcastPages),
  INBOUND_QUEUE: platform.queues.producer(QUEUES.inbound),
  SEGMENTS_QUEUE: platform.queues.producer(QUEUES.segments),
  AUTOMATION_QUEUE: platform.queues.producer(QUEUES.automationTriggers),
  DMARC_QUEUE: platform.queues.producer(QUEUES.dmarc),
  EXPORT_QUEUE: platform.queues.producer(QUEUES.export),

  EMAIL_EVENTS: platform.analytics(ANALYTICS_DATASETS.emailEvents),
  API_USAGE: platform.analytics(ANALYTICS_DATASETS.apiUsage),

  SENDING_DOMAIN: platform.actors.namespace('SendingDomain'),
  BROADCAST: platform.actors.namespace('Broadcast'),
  BROADCAST_COUNTER: platform.actors.namespace('BroadcastCounter'),
  WEBHOOK_ENDPOINT: platform.actors.namespace('WebhookEndpoint'),
  SCHEDULE_SHARD: platform.actors.namespace('ScheduleShard'),
  MAILBOX: platform.actors.namespace('Mailbox'),
  SEGMENT: platform.actors.namespace('Segment'),
  AUTOMATION_COHORT: platform.actors.namespace('AutomationCohort'),
  AUTOMATION_RUN: platform.actors.namespace('AutomationRun'),
  WORKSPACE_HUB: platform.actors.namespace('WorkspaceHub'),

  ...(process.env.CLOUDFLARE_ACCOUNT_ID
    ? { CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID }
    : {}),
  ...(process.env.CLOUDFLARE_API_TOKEN
    ? { CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN }
    : {}),
  ...(process.env.SES_ACCESS_KEY_ID ? { SES_ACCESS_KEY_ID: process.env.SES_ACCESS_KEY_ID } : {}),
  ...(process.env.SES_SECRET_ACCESS_KEY
    ? { SES_SECRET_ACCESS_KEY: process.env.SES_SECRET_ACCESS_KEY }
    : {}),
  ...(process.env.SES_REGION ? { SES_REGION: process.env.SES_REGION } : {}),
  ...(process.env.SES_CONFIGURATION_SET
    ? { SES_CONFIGURATION_SET: process.env.SES_CONFIGURATION_SET }
    : {}),
  ...(process.env.RESEND_API_KEY ? { RESEND_API_KEY: process.env.RESEND_API_KEY } : {}),
  ...(process.env.SMTP_HOST ? { SMTP_HOST: process.env.SMTP_HOST } : {}),
  ...(process.env.SMTP_PORT ? { SMTP_PORT: process.env.SMTP_PORT } : {}),
  ...(process.env.SMTP_USER ? { SMTP_USER: process.env.SMTP_USER } : {}),
  ...(process.env.SMTP_PASS ? { SMTP_PASS: process.env.SMTP_PASS } : {}),
  ...(process.env.SMTP_SECURE
    ? { SMTP_SECURE: process.env.SMTP_SECURE as Env['SMTP_SECURE'] }
    : {}),
}

Object.assign(platform.env, env)

/**
 * `MS_SECRET` signs tracking tokens, unsubscribe links and reply addresses.
 *
 * This used to refuse to start without one, because a secret regenerated per
 * boot invalidates every link in every message already delivered. That reason
 * is gone: an unset secret is now generated once and *persisted* (see
 * `bootstrap.ts`), so it survives restarts and redeploys. Setting it explicitly
 * is still better — it keeps the signing key out of the database and lets you
 * rotate it — but it is no longer the difference between a deployment that
 * boots and one that does not.
 *
 * A secret that is set but too short is still refused: that is a mistake, not a
 * choice, and silently accepting it would weaken every signature.
 */
function configuredSecret(): string {
  const secret = process.env.MS_SECRET
  if (!secret) return ''
  if (secret.length >= 32) return secret
  console.error('MS_SECRET is set but shorter than 32 characters. Generate one with:')
  console.error('  openssl rand -hex 32')
  process.exit(1)
}

/** Workers gives handlers an ExecutionContext; on Node the process outlives the request. */
const nodeCtx = {
  waitUntil(promise: Promise<unknown>) {
    promise.catch((err) => console.error('[background]', err))
  },
  passThroughOnException() {},
}

// --- queue consumers -------------------------------------------------------
// The same handlers the Workers runtime calls. There is no Node-specific
// business logic anywhere; only the driver differs.
platform.queues.consumer(QUEUES.send, (batch) =>
  runWithEnv(env, nodeCtx, () => consumeSend(batch as never, env)),
)
platform.queues.consumer(QUEUES.sendBulk, (batch) =>
  runWithEnv(env, nodeCtx, () => consumeSend(batch as never, env)),
)
platform.queues.consumer(QUEUES.eventsNormalized, (batch) =>
  runWithEnv(env, nodeCtx, () => consumeEventQueue(batch as never, env)),
)
platform.queues.consumer(QUEUES.webhooks, (batch) =>
  runWithEnv(env, nodeCtx, () => consumeWebhooks(batch as never, env)),
)
platform.queues.consumer(QUEUES.broadcastPages, (batch) =>
  runWithEnv(env, nodeCtx, () => consumeBroadcastPages(batch as never, env)),
)
platform.queues.consumer(QUEUES.inbound, (batch) =>
  runWithEnv(env, nodeCtx, () => consumeInbound(batch as never, env)),
)
for (const queue of [QUEUES.segments, QUEUES.automationTriggers, QUEUES.dmarc, QUEUES.export]) {
  platform.queues.consumer(queue, (batch) =>
    runWithEnv(env, nodeCtx, () => consumeMisc(batch as never, env)),
  )
}

// --- lifecycle -------------------------------------------------------------

let started: Promise<Env> | null = null

/**
 * Idempotent, and awaited by the first request rather than run at import time.
 *
 * Import-time side effects would run during the prerender pass too, which
 * builds the marketing pages — creating a database and a bootstrap API key as
 * a side effect of `vite build` is not what anyone means by a static build.
 */
export function startNodeRuntime(): Promise<Env> {
  started ??= (async () => {
    // Resolves — and persists — anything the operator did not set, then folds
    // it back into the shared binding object so the queue consumers and cron,
    // which never see a request, sign with the same secret the request path does.
    await configure(env)
    Object.assign(platform.env, env)
    platform.start()

    // Cron on Workers; a timer here. One schedule, as on Workers, where three
    // of them ate three of the five a free account is allowed — `runCron`
    // decides what a given tick owes, so this stays a single edit.
    const timer = setInterval(() => {
      void runWithEnv(env, nodeCtx, () => runCron('* * * * *', env)).catch((err) =>
        console.error('[cron]', err),
      )
    }, 60_000)
    timer.unref()

    console.log(
      `[mailysend] node runtime ready (mode=${env.MS_MODE}, data=${DATA_DIR}, port=${PORT})`,
    )
    return env
  })()
  return started
}

export { env as nodeEnv, nodeCtx, platform }
