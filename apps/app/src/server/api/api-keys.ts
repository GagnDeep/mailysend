import { apiError, CreateApiKeyRequest } from '@mailysend/contracts'
import { apiKeyPreview, generateApiKey, hashApiKey, kvKey, newId } from '@mailysend/core'
import { requireRole, requireScope } from '../auth.ts'
import { type App, createRouter, json, page, parseLimit, withContext } from './base.ts'

/**
 * `/v1/api-keys`.
 *
 * The token is generated, returned once and then unrecoverable: only its
 * SHA-256 and a 12-character preview are stored, so a database dump yields no
 * working credentials and support can still say *which* key a customer means.
 * There is no endpoint that returns a token, and no SELECT below reads
 * `token_hash` into a response.
 */

const apiKeys: App = createRouter()

apiKeys.use('*', withContext())

apiKeys.post('/', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'api_keys:write')
  requireRole(ctx.actor, 'developer')
  const body = CreateApiKeyRequest.parse(await c.req.json())

  if (body.domain_id) {
    const domain = await ctx.sql
      .prepare('SELECT id FROM domains WHERE id = ? AND workspace_id = ?')
      .bind(body.domain_id, ctx.workspace.id)
      .first<{ id: string }>()
    if (!domain) throw apiError('not_found', { param: 'domain_id', message: 'No such domain.' })
  }

  const id = newId('apiKey')
  const now = new Date().toISOString()
  // A key inherits the environment of the actor minting it, so a test-mode
  // session cannot hand out a live-sending credential by accident.
  const token = generateApiKey(ctx.actor.environment)

  await ctx.sql
    .prepare(
      `INSERT INTO api_keys (id, workspace_id, name, token_hash, token_preview, environment,
                             permission, domain_id, created_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      ctx.workspace.id,
      body.name,
      await hashApiKey(token),
      apiKeyPreview(token),
      ctx.actor.environment,
      body.permission,
      body.domain_id ?? null,
      ctx.actor.userId ?? null,
      body.expires_at ?? null,
      now,
    )
    .run()

  return json(
    {
      object: 'api_key',
      id,
      name: body.name,
      permission: body.permission,
      environment: ctx.actor.environment,
      domain_id: body.domain_id ?? null,
      expires_at: body.expires_at ?? null,
      created_at: now,
      token_preview: apiKeyPreview(token),
      /** The only response in the whole API that carries this field. */
      token,
    },
    201,
  )
})

apiKeys.get('/', async (c) => {
  const ctx = c.get('ctx')
  const limit = parseLimit(c.req.query('limit'))
  const cursor = c.req.query('cursor')

  const rows = await ctx.sql
    .prepare(
      `SELECT id, name, token_preview, environment, permission, domain_id, created_by,
              last_used_at, expires_at, revoked_at, created_at
         FROM api_keys
        WHERE workspace_id = ? ${cursor ? 'AND id < ?' : ''}
        ORDER BY id DESC LIMIT ?`,
    )
    .bind(ctx.workspace.id, ...(cursor ? [cursor] : []), limit + 1)
    .all<KeyRow>()

  return json(page(rows.results.map(toApiKey), limit))
})

apiKeys.get('/:id', async (c) => {
  const ctx = c.get('ctx')
  const row = await ctx.sql
    .prepare(
      `SELECT id, name, token_preview, environment, permission, domain_id, created_by,
              last_used_at, expires_at, revoked_at, created_at
         FROM api_keys WHERE id = ? AND workspace_id = ?`,
    )
    .bind(c.req.param('id'), ctx.workspace.id)
    .first<KeyRow>()
  if (!row) throw apiError('not_found')
  return json(toApiKey(row))
})

/**
 * Revocation.
 *
 * The row is marked rather than deleted — an audit trail that loses the key a
 * leak was traced to is not an audit trail — and the KV entry the auth path
 * caches for 300s is dropped in the same request. Waiting out that TTL is five
 * minutes of a known-compromised credential still working, which is exactly the
 * window nobody wants to explain.
 */
apiKeys.delete('/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'api_keys:write')
  requireRole(ctx.actor, 'developer')
  const id = c.req.param('id')

  const row = await ctx.sql
    .prepare('SELECT id, token_hash, revoked_at FROM api_keys WHERE id = ? AND workspace_id = ?')
    .bind(id, ctx.workspace.id)
    .first<{ id: string; token_hash: string; revoked_at: string | null }>()
  if (!row) throw apiError('not_found')

  const revokedAt = row.revoked_at ?? new Date().toISOString()
  if (!row.revoked_at) {
    await ctx.sql
      .prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND workspace_id = ?')
      .bind(revokedAt, id, ctx.workspace.id)
      .run()
  }

  // Awaited, not backgrounded: the caller is entitled to treat a 200 here as
  // "that key is dead now".
  await ctx.cache.delete(kvKey.apiKey(row.token_hash))

  return json({ object: 'api_key', id, revoked_at: revokedAt, deleted: true })
})

interface KeyRow {
  id: string
  name: string
  token_preview: string
  environment: string
  permission: string
  domain_id: string | null
  created_by: string | null
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
  created_at: string
}

const toApiKey = (row: KeyRow) => ({
  object: 'api_key' as const,
  id: row.id,
  name: row.name,
  token_preview: row.token_preview,
  environment: row.environment,
  permission: row.permission,
  domain_id: row.domain_id,
  created_by: row.created_by,
  last_used_at: row.last_used_at,
  expires_at: row.expires_at,
  revoked_at: row.revoked_at,
  created_at: row.created_at,
})

export { apiKeys }
