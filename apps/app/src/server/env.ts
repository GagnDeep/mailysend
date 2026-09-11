import { AsyncLocalStorage } from 'node:async_hooks'
import type { Analytics, Blob, Kv, Queue, Sql } from '@mailysend/platform'

/**
 * The binding surface.
 *
 * Property names match `wrangler.jsonc` exactly, and the Node bootstrap
 * assembles an object with the same names — so application code reads
 * `env.DB` and `env.SEND_QUEUE` and never learns which runtime it is on.
 */
export interface Env {
  // --- configuration ------------------------------------------------------
  /** `single` for a self-hosted deployment, `saas` for the hosted product. */
  /** Defaulted to `single` by `configure()`; absent until then. */
  MS_MODE: 'single' | 'saas'
  MS_PUBLIC_URL: string
  MS_TRACKING_URL?: string
  /** Signs tracking tokens, reply tokens and unsubscribe links. */
  MS_SECRET: string
  /** Encrypts provider credentials at rest. */
  MS_DATA_KEY?: string
  MS_DEFAULT_PROVIDER?: 'cloudflare' | 'ses' | 'resend' | 'smtp'
  MS_LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error'
  /**
   * The dashboard owner. Their first sign-in is what turns a fresh deployment
   * into one with a human in it, so on a bootstrap instance — no verified
   * sending domain yet, therefore no way to email anything — their one-time
   * code is written to the process log instead. Only theirs, and only until a
   * domain verifies.
   */
  MS_OWNER_EMAIL?: string
  /**
   * Ask `/setup` for the first-boot claim code before it will let anyone claim
   * the instance. Off unless set to `1`, `true`, `yes`, `on` or `required`.
   *
   * The claim window it closes is real but short — between a deployment
   * answering its first request and its operator reaching `/setup` — and the
   * code that closes it lives only in a log line the operator is unlikely to be
   * watching. Worth it for a deployment on a URL that is public before anyone
   * gets to it; not worth it as a default. `MS_OWNER_EMAIL` is the other way to
   * hold the claim, and setting both is two locks on one door: this one yields.
   */
  MS_REQUIRE_CLAIM_CODE?: string
  /** Cloudflare Access team domain, e.g. `acme.cloudflareaccess.com`. */
  MS_ACCESS_TEAM?: string
  /** The Access application's AUD tag. Both must be set for Access to be on. */
  MS_ACCESS_AUD?: string
  /**
   * OpenID Connect, optional. All three of issuer, client id and client secret
   * must be present for the sign-in button to appear — the same rule that keeps
   * the Access button off an instance that has not configured Access.
   */
  MS_OIDC_ISSUER?: string
  MS_OIDC_CLIENT_ID?: string
  MS_OIDC_CLIENT_SECRET?: string
  /** Comma-separated. Empty means any address the provider will vouch for. */
  MS_OIDC_ALLOWED_DOMAINS?: string
  /** `true` enrols an unknown address on first sign-in; requires an allowlist. */
  MS_OIDC_AUTO_PROVISION?: string
  /** What the button says. Defaults to "single sign-on". */
  MS_OIDC_LABEL?: string
  /** Turning this off reconstructs message timelines from the R2 archive. */
  EVENT_DETAIL?: 'on' | 'off'
  /**
   * What `/` serves.
   *
   * `app` — a self-hosted instance: the root redirects to the dashboard (or to
   * `/setup` while the instance is unclaimed), and the marketing pages stay
   * reachable by URL. `marketing` — mailysend.com, which runs this same build
   * in the same mode and does want the shop window at the root.
   *
   * Defaulted by `configure()` from `MS_MODE`; absent until then.
   */
  MS_LANDING: 'app' | 'marketing'

  // --- storage ------------------------------------------------------------
  DB: Sql
  CACHE: Kv
  SUPPRESSIONS: Kv
  BUCKET: Blob

  // --- queues -------------------------------------------------------------
  SEND_QUEUE: Queue
  SEND_BULK_QUEUE: Queue
  EVENTS_QUEUE: Queue
  WEBHOOKS_QUEUE: Queue
  BROADCAST_QUEUE: Queue
  INBOUND_QUEUE: Queue
  SEGMENTS_QUEUE: Queue
  AUTOMATION_QUEUE: Queue
  DMARC_QUEUE: Queue
  EXPORT_QUEUE: Queue

  // --- analytics ----------------------------------------------------------
  EMAIL_EVENTS?: Analytics
  API_USAGE?: Analytics

  // --- actors -------------------------------------------------------------
  SENDING_DOMAIN: ActorNs
  BROADCAST: ActorNs
  BROADCAST_COUNTER: ActorNs
  WEBHOOK_ENDPOINT: ActorNs
  SCHEDULE_SHARD: ActorNs
  MAILBOX: ActorNs
  SEGMENT: ActorNs
  AUTOMATION_COHORT: ActorNs
  AUTOMATION_RUN: ActorNs
  WORKSPACE_HUB: ActorNs

  // --- outbound -----------------------------------------------------------
  /**
   * The `send_email` binding. Present only on Workers.
   *
   * Cloudflare Email Service reads structured fields. This said `raw` — a field
   * it does not have — so the typechecker agreed with an adapter that could
   * never send anything. `CloudflareEmail` in the providers package is the
   * shape the service actually documents; this defers to it.
   */
  SEND_EMAIL?: import('@mailysend/providers').SendEmailBinding
  CLOUDFLARE_ACCOUNT_ID?: string
  CLOUDFLARE_API_TOKEN?: string
  SES_ACCESS_KEY_ID?: string
  SES_SECRET_ACCESS_KEY?: string
  SES_REGION?: string
  SES_CONFIGURATION_SET?: string
  RESEND_API_KEY?: string
  SMTP_HOST?: string
  SMTP_PORT?: string
  SMTP_USER?: string
  SMTP_PASS?: string
  SMTP_SECURE?: 'tls' | 'starttls' | 'none'

  // --- runtime hooks (Node only; on Workers these are queue producers) -----
  ASSETS?: { fetch(request: Request): Promise<Response> }
}

/** Loose actor namespace type; the concrete stubs are typed at each call site. */
export type ActorNs = { get(name: string): any }

/**
 * Request-scoped env.
 *
 * TanStack Start's server functions and route loaders do not receive the
 * Worker's `env` argument, so it has to be ambient. AsyncLocalStorage is the
 * only mechanism that is both correct under concurrency and available on both
 * runtimes (Workers exposes it under `nodejs_compat`); a module-level variable
 * would leak one request's workspace into another's under load.
 */
const store = new AsyncLocalStorage<{ env: Env; ctx: ExecutionContextLike }>()

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException?(): void
}

export const runWithEnv = <T>(env: Env, ctx: ExecutionContextLike, fn: () => T): T =>
  store.run({ env, ctx }, fn)

export const getEnv = (): Env => {
  const held = store.getStore()
  if (!held) {
    throw new Error(
      'getEnv() was called outside a request. Wrap the entry point in runWithEnv(), or pass env explicitly from a queue consumer.',
    )
  }
  return held.env
}

export const getExecutionContext = (): ExecutionContextLike =>
  store.getStore()?.ctx ?? { waitUntil: () => {} }

/** Background work that must not delay the response. */
export const background = (promise: Promise<unknown>): void => {
  getExecutionContext().waitUntil(promise.catch((err) => console.error('[background]', err)))
}
