import type { Kv, Sql } from '@mailysend/platform'
import { DEFAULT_WORKSPACE, KV_TTL, kvKey } from './keys.ts'

/**
 * The single-tenant / multi-tenant seam.
 *
 * There are exactly three interfaces, resolved once per request in middleware.
 * Everything else in the codebase is written as if multi-tenant, unconditionally
 * — including the self-hosted deployment, which simply has one workspace row
 * called `ws_default`.
 *
 * This is the most important boundary in the repo. The failure mode it prevents
 * is the one that kills dual-distribution projects: a slow accumulation of
 * `if (selfHost)` branches in data-access code until the two modes are
 * effectively different products sharing a git history.
 */

export type Mode = 'single' | 'saas'

export interface Workspace {
  id: string
  name: string
  plan: string
  created_at: string
  /** Per-workspace overrides on top of mode and plan defaults. */
  flags: Record<string, unknown>
}

export interface Actor {
  workspaceId: string
  /** Present for dashboard sessions; absent for API-key traffic. */
  userId?: string
  /** Present for API-key traffic. */
  apiKeyId?: string
  /** `test` traffic never touches a real provider and never bills. */
  environment: 'live' | 'test'
  scopes: string[]
  role?: 'owner' | 'developer' | 'marketer' | 'read_only'
}

/** Resolves the workspace for a request and, in SaaS mode, its database shard. */
export interface Tenancy {
  readonly mode: Mode
  resolve(actor: Actor): Promise<Workspace>
  /** In single-tenant mode this always returns the one binding. */
  db(workspaceId: string): Sql
}

export interface AuthN {
  /** Byte-identical in both modes: an API key is an API key. */
  fromApiKey(token: string): Promise<Actor | null>
  /** The only genuinely divergent piece: Access JWT vs. session cookie. */
  fromRequest(request: Request): Promise<Actor | null>
}

export interface Billing {
  /** Returns false and a reason when a hard limit is hit. */
  checkQuota(
    workspaceId: string,
    kind: 'emails' | 'contacts' | 'domains',
    delta: number,
  ): Promise<{ ok: true } | { ok: false; reason: string; limit: number }>
  record(workspaceId: string, kind: string, quantity: number): void
}

/**
 * Feature resolution is a pure function of four layers, applied in order.
 * Making it pure — rather than a scattering of environment checks — is what
 * lets the dashboard render an accurate "not available in this deployment"
 * state instead of a button that fails when pressed.
 */
export interface Features {
  /** The hosted product bills; a self-host deployment has no billing at all. */
  billing: boolean
  /** Cloudflare for SaaS custom hostnames for tracking domains. */
  customHostnames: boolean
  /** Workflows-backed automations. False on Node, where the scheduler runs them. */
  workflows: boolean
  /** Inbox placement via seed panels. Needs seed accounts, so hosted-only by default. */
  seedTesting: boolean
  /** Multi-user membership and RBAC. A single-tenant deployment gates on Access instead. */
  teams: boolean
  /** Retain per-event rows in SQL. Turning it off reconstructs timelines from R2. */
  eventDetail: boolean
  /** The MCP server for agent mailboxes. */
  mcp: boolean
  /** Long-term parquet export to object storage. */
  archive: boolean
}

const MODE_DEFAULTS: Record<Mode, Features> = {
  single: {
    billing: false,
    customHostnames: false,
    workflows: true,
    seedTesting: false,
    teams: false,
    eventDetail: true,
    mcp: true,
    archive: true,
  },
  saas: {
    billing: true,
    customHostnames: true,
    workflows: true,
    seedTesting: true,
    teams: true,
    eventDetail: true,
    mcp: true,
    archive: true,
  },
}

const PLAN_OVERRIDES: Record<string, Partial<Features>> = {
  free: { seedTesting: false, archive: false },
  pro: {},
  scale: {},
  /** What a self-hosted deployment's single workspace runs on. */
  self_hosted: {},
}

export const resolveFeatures = (
  mode: Mode,
  plan: string,
  workspaceFlags: Record<string, unknown> = {},
  runtime: Partial<Features> = {},
): Features => {
  const base = { ...MODE_DEFAULTS[mode], ...(PLAN_OVERRIDES[plan] ?? {}) }
  // Runtime capability always wins: promising Workflows on a runtime that has
  // no Workflows engine would surface as a confusing failure much later.
  for (const [k, v] of Object.entries(runtime)) {
    if (v === false) (base as Record<string, unknown>)[k] = false
  }
  for (const [k, v] of Object.entries(workspaceFlags)) {
    if (k in base && typeof v === 'boolean') (base as Record<string, unknown>)[k] = v
  }
  return base
}

/**
 * Single-tenant tenancy: one workspace, one database, no routing.
 * It still goes through the same interface so that no call site knows.
 */
export class SingleTenancy implements Tenancy {
  readonly mode = 'single' as const
  #db: Sql
  #kv: Kv

  constructor(db: Sql, kv: Kv) {
    this.#db = db
    this.#kv = kv
  }

  async resolve(_actor: Actor): Promise<Workspace> {
    const cached = await this.#kv.get<Workspace>(kvKey.workspace(DEFAULT_WORKSPACE), 'json')
    if (cached) return cached
    const row = await this.#db
      .prepare('SELECT id, name, plan, created_at, flags FROM workspaces WHERE id = ?')
      .bind(DEFAULT_WORKSPACE)
      .first<{ id: string; name: string; plan: string; created_at: string; flags: string | null }>()
    const ws: Workspace = row
      ? { ...row, flags: row.flags ? JSON.parse(row.flags) : {} }
      : {
          id: DEFAULT_WORKSPACE,
          name: 'MailySend',
          plan: 'self_hosted',
          created_at: new Date().toISOString(),
          flags: {},
        }
    await this.#kv.put(kvKey.workspace(DEFAULT_WORKSPACE), JSON.stringify(ws), {
      expirationTtl: KV_TTL.workspace,
    })
    return ws
  }

  db(): Sql {
    return this.#db
  }
}

/** Billing is a no-op in single-tenant mode, not an absent concept. */
export class NoBilling implements Billing {
  async checkQuota() {
    return { ok: true } as const
  }
  record() {}
}
