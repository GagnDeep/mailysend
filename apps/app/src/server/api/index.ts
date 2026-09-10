import { apiError } from '@mailysend/contracts'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { VERSION } from '../../version.ts'
import { analytics } from './analytics.ts'
import { apiKeys } from './api-keys.ts'
import { audiences } from './audiences.ts'
import { auth } from './auth.ts'
import { automations } from './automations.ts'
import { errorResponse, type Vars, withContext } from './base.ts'
import { broadcasts } from './broadcasts.ts'
import { contacts } from './contacts.ts'
import { domains } from './domains.ts'
import { emails } from './emails.ts'
import { inbound } from './inbound.ts'
import { instance } from './instance.ts'
import { logs } from './logs.ts'
import { mail } from './mail.ts'
import { mcpConfirmations } from './mcp-confirmations.ts'
import { openApiDocument } from './openapi.ts'
import { preferences } from './preferences.ts'
import { providers } from './providers.ts'
import { segments } from './segments.ts'
import { setup } from './setup.ts'
import { suppressions } from './suppressions.ts'
import { templates } from './templates.ts'
import { webhooks } from './webhooks.ts'
import { workspace } from './workspace.ts'

/**
 * The `/v1` surface.
 *
 * Mount order matters only in that `/emails/batch` must be reachable — Hono
 * matches `/batch` before `/:id` because static segments win, so it is.
 */
export const api = new Hono<{ Variables: Vars }>().basePath('/v1')

api.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: ['authorization', 'content-type', 'idempotency-key', 'ms-environment'],
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86_400,
  }),
)

api.onError((err) => errorResponse(err))
api.notFound(() =>
  Response.json(
    {
      statusCode: 404,
      name: 'not_found',
      message: 'No such endpoint. See https://mailysend.com/docs/api for the full surface.',
      code: 'not_found',
    },
    { status: 404 },
  ),
)

api.route('/emails', emails)
api.route('/domains', domains)
api.route('/api-keys', apiKeys)
api.route('/audiences', audiences)
api.route('/contacts', contacts)
api.route('/segments', segments)
api.route('/broadcasts', broadcasts)
api.route('/automations', automations)
api.route('/templates', templates)
api.route('/suppressions', suppressions)
api.route('/webhooks', webhooks)
api.route('/logs', logs)
api.route('/analytics', analytics)
api.route('/inbound', inbound)
api.route('/mail', mail)
api.route('/mcp/confirmations', mcpConfirmations)
api.route('/providers', providers)
api.route('/workspace', workspace)
api.route('/preference-centre', preferences)
// Unauthenticated by design — this is how a session comes into existence.
api.route('/auth', auth)
// Also unauthenticated, and also by design: `/v1/instance` is what the sign-in
// page reads *before* anyone can be authenticated, and `/v1/setup` is how a
// deployment gets its first human. Both refuse to do anything once the instance
// has an owner, which is the property that makes them safe to leave open.
api.route('/instance', instance)
api.route('/setup', setup)

/**
 * `GET /v1/me` — who the caller is, and what they can switch between.
 *
 * The dashboard calls this first on every load, so it doubles as the session
 * check: a 401 here is what sends a signed-out visitor to the sign-in page.
 */
api.get('/me', withContext(), async (c) => {
  const ctx = c.get('ctx')
  if (!ctx.actor.userId) {
    // An API key is not a person. Returning a fabricated user here would make
    // the dashboard look signed in to anyone holding a key.
    throw apiError('not_signed_in')
  }

  const user = await ctx.sql
    .prepare('SELECT id, email, name, avatar_url FROM users WHERE id = ?')
    .bind(ctx.actor.userId)
    .first<{ id: string; email: string; name: string | null; avatar_url: string | null }>()
  if (!user) throw apiError('not_signed_in')

  const { results } = await ctx.sql
    .prepare(
      `SELECT w.id, w.name, w.slug, w.plan, w.created_at, m.role
         FROM memberships m
         JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.user_id = ?
        ORDER BY m.created_at`,
    )
    .bind(user.id)
    .all<{
      id: string
      name: string
      slug: string
      plan: string
      created_at: string
      role: string
    }>()

  return Response.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatar_url: user.avatar_url,
    // The client had no way to see any of this and was guessing — which is how
    // a hardcoded `v1.8.2` survived on four screens. One source, served here.
    mode: ctx.env.MS_MODE,
    version: VERSION,
    features: ctx.features,
    workspaces: results.map((w) => ({
      object: 'workspace' as const,
      id: w.id,
      name: w.name,
      slug: w.slug,
      plan: w.plan,
      created_at: w.created_at,
      role: w.role,
    })),
  })
})

/** Health is deliberately unauthenticated: a load balancer cannot hold a key. */
api.get('/health', async (c) => {
  const { getEnv } = await import('../env.ts')
  const env = getEnv()
  let database = 'ok'
  try {
    await env.DB.prepare('SELECT 1').first()
  } catch (err) {
    database = err instanceof Error ? err.message : 'unavailable'
  }
  return c.json(
    {
      status: database === 'ok' ? 'operational' : 'degraded',
      mode: env.MS_MODE,
      version: VERSION,
      database,
      time: new Date().toISOString(),
    },
    database === 'ok' ? 200 : 503,
  )
})

api.get('/openapi.json', async () => Response.json(await openApiDocument()))
