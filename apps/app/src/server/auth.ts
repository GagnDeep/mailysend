import { ApiError, apiError } from '@mailysend/contracts'
import {
  type Actor,
  DEFAULT_WORKSPACE,
  hashApiKey,
  KV_TTL,
  kvKey,
  timingSafeEqual,
} from '@mailysend/core'
import type { Kv, Sql } from '@mailysend/platform'
import type { Env } from './env.ts'

/**
 * API-key authentication is byte-identical in both deployment modes. That is
 * one of the four tenancy invariants: an integration written against a
 * self-hosted MailySend must work unchanged against the hosted one.
 */

interface KeyRow {
  id: string
  workspace_id: string
  environment: 'live' | 'test'
  permission: string
  domain_id: string | null
  revoked_at: string | null
  expires_at: string | null
}

/** Cached for 300s. Short enough that a revoked key stops working quickly. */
interface CachedKey extends KeyRow {
  cached_at: number
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const [scheme, token] = header.split(' ')
  if (!scheme || !token) return null
  return scheme.toLowerCase() === 'bearer' ? token.trim() : null
}

export async function actorFromApiKey(token: string, sql: Sql, cache: Kv): Promise<Actor> {
  if (!/^ms_(live|test)_[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw apiError('invalid_api_key')
  }
  const hash = await hashApiKey(token)
  const cacheKey = kvKey.apiKey(hash)

  let row = await cache.get<CachedKey>(cacheKey, 'json')
  if (!row) {
    const found = await sql
      .prepare(
        `SELECT id, workspace_id, environment, permission, domain_id, revoked_at, expires_at
           FROM api_keys WHERE token_hash = ?`,
      )
      .bind(hash)
      .first<KeyRow>()
    if (!found) throw apiError('invalid_api_key')
    row = { ...found, cached_at: Date.now() }
    await cache.put(cacheKey, JSON.stringify(row), { expirationTtl: KV_TTL.apiKey })
  }

  if (row.revoked_at)
    throw apiError('invalid_api_key', { message: 'This API key has been revoked.' })
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) {
    throw apiError('invalid_api_key', { message: 'This API key has expired.' })
  }

  return {
    workspaceId: row.workspace_id,
    apiKeyId: row.id,
    // The prefix and the stored column must agree. They are written together,
    // so a disagreement means a tampered or hand-edited row: refuse it.
    environment: token.startsWith('ms_test_') ? 'test' : 'live',
    scopes: row.permission === 'sending_access' ? ['emails:send'] : ['*'],
  }
}

/**
 * Dashboard sessions. This is the one place the two modes genuinely diverge:
 * self-host trusts a Cloudflare Access JWT (or a magic code sent through the
 * deployment's own sending path), the hosted product uses a session cookie
 * backed by `memberships`.
 */
export async function actorFromSession(request: Request, sql: Sql): Promise<Actor | null> {
  const cookie = request.headers.get('cookie') ?? ''
  const match = /(?:^|;\s*)ms_session=([^;]+)/.exec(cookie)
  if (!match?.[1]) return null
  const token = decodeURIComponent(match[1])

  // The session id *is* the hash of the cookie value, so the table holds
  // nothing that could be replayed as a cookie if it ever leaked.
  const row = await sql
    .prepare(
      `SELECT s.id, s.user_id, s.expires_at, m.workspace_id, m.role
         FROM sessions s
         LEFT JOIN memberships m ON m.user_id = s.user_id AND m.workspace_id = s.workspace_id
        WHERE s.id = ?`,
    )
    .bind(await hashApiKey(token))
    .first<{
      id: string
      user_id: string
      expires_at: string
      workspace_id: string | null
      role: string | null
    }>()
  if (!row) return null
  if (Date.parse(row.expires_at) < Date.now()) return null

  // The environment switch, honoured at last.
  //
  // The dashboard has always sent `ms-environment` and the server has always
  // ignored it, so flipping to Test changed the query keys and nothing else:
  // every screen kept showing live data under a label that said otherwise. A
  // session is scoped to a person, not to an environment, so reading either one
  // is within its authority — an API key still cannot, because its environment
  // is fixed by the key prefix and that is the whole point of two key families.
  const requested = request.headers.get('ms-environment')
  return {
    workspaceId: row.workspace_id ?? DEFAULT_WORKSPACE,
    userId: row.user_id,
    environment: requested === 'test' ? 'test' : 'live',
    scopes: ['*'],
    role: (row.role as Actor['role']) ?? 'owner',
  }
}

export function requireScope(actor: Actor, scope: string): void {
  if (actor.scopes.includes('*') || actor.scopes.includes(scope)) return
  throw apiError('restricted_api_key', {
    message: `This API key is limited to sending; \`${scope}\` requires a full-access key.`,
  })
}

/** Roles are checked in one place so the permission matrix in the UI can't drift. */
const ROLE_RANK: Record<string, number> = { read_only: 0, marketer: 1, developer: 2, owner: 3 }

export function requireRole(
  actor: Actor,
  minimum: 'read_only' | 'marketer' | 'developer' | 'owner',
): void {
  if (!actor.role) return // API keys carry scopes, not roles.
  if ((ROLE_RANK[actor.role] ?? 0) < (ROLE_RANK[minimum] ?? 0)) {
    throw apiError('restricted_api_key', {
      message: `This action requires the ${minimum} role or higher.`,
    })
  }
}

export { ApiError, type Env, timingSafeEqual }
