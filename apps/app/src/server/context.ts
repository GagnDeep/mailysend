import {
  type Actor,
  DEFAULT_WORKSPACE,
  type Features,
  NoBilling,
  resolveFeatures,
  SingleTenancy,
  type Tenancy,
  type Workspace,
} from '@mailysend/core'
import type { Blob, Kv, Sql } from '@mailysend/platform'
import type { Env } from './env.ts'

/**
 * Everything a request handler is allowed to reach for.
 *
 * Handlers receive this rather than `Env` so that no route ever picks a
 * database binding by name — in SaaS mode the shard is chosen by `tenancy.db()`
 * from the resolved workspace, and a handler that reached for `env.DB` directly
 * would work in single-tenant mode and silently read the wrong shard in the
 * hosted one. Making that mistake impossible is worth the indirection.
 */
export interface Ctx {
  env: Env
  actor: Actor
  workspace: Workspace
  features: Features
  sql: Sql
  cache: Kv
  suppressions: Kv
  blob: Blob
  tenancy: Tenancy
  /** Absolute base for links we mint (tracking pixels, unsubscribe, dashboard). */
  publicUrl: string
  trackingUrl: string
  /** Fire-and-forget after the response is written. */
  background(promise: Promise<unknown>): void
}

export const anonymousActor = (): Actor => ({
  workspaceId: DEFAULT_WORKSPACE,
  environment: 'live',
  scopes: [],
})

let cachedTenancy: { env: Env; tenancy: Tenancy } | null = null

export function tenancyFor(env: Env): Tenancy {
  if (cachedTenancy?.env === env) return cachedTenancy.tenancy
  // SaaS routing lands here later; the interface is already the one call sites
  // use, so adding it is a new class rather than an edit to every handler.
  const tenancy = new SingleTenancy(env.DB, env.CACHE)
  cachedTenancy = { env, tenancy }
  return tenancy
}

export const billingFor = (_env: Env) => new NoBilling()

export async function buildContext(
  env: Env,
  actor: Actor,
  background: (p: Promise<unknown>) => void,
): Promise<Ctx> {
  const tenancy = tenancyFor(env)
  const workspace = await tenancy.resolve(actor)
  const features = resolveFeatures(env.MS_MODE, workspace.plan, workspace.flags, {
    // A deployment can force detail off to cut D1 write cost; the dashboard
    // then reconstructs timelines from the R2 archive and says so.
    eventDetail: env.EVENT_DETAIL !== 'off',
  })
  return {
    env,
    actor,
    workspace,
    features,
    sql: tenancy.db(workspace.id),
    cache: env.CACHE,
    suppressions: env.SUPPRESSIONS,
    blob: env.BUCKET,
    tenancy,
    publicUrl: env.MS_PUBLIC_URL.replace(/\/$/, ''),
    trackingUrl: (env.MS_TRACKING_URL ?? env.MS_PUBLIC_URL).replace(/\/$/, ''),
    background,
  }
}
