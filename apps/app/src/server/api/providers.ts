import { apiError } from '@mailysend/contracts'
import { newId } from '@mailysend/core'
import { z } from 'zod'
import { requireRole, requireScope } from '../auth.ts'
import type { Ctx } from '../context.ts'
import {
  buildProviderFor,
  decryptCredentials,
  encryptCredentials,
  resolveDefaultProvider,
} from '../services/providers.ts'
import { type App, createRouter, json, withContext } from './base.ts'

/**
 * `/v1/providers` — the write path that never existed.
 *
 * `provider_configs` has been in the schema since the first migration and no
 * code has ever inserted a row into it: `encryptCredentials` was written,
 * tested by nothing and called by nothing, the Settings screen's transport
 * radio wrote to a settings key `buildRouter` does not read, and
 * `docs/CONFIGURATION.md` has described a "Settings → Providers" screen that
 * did not exist. So every deployment has run on environment variables whether
 * its operator meant to or not.
 *
 * Credentials go in and never come back out. The response says which fields are
 * set, never what they are set to — the same rule as API keys and webhook
 * secrets, for the same reason.
 */

const providers: App = createRouter()

providers.use('*', withContext())

const NAMES = ['cloudflare', 'ses', 'resend', 'smtp'] as const
type Name = (typeof NAMES)[number]

interface ConfigRow {
  id: string
  provider: Name
  enabled: number
  priority: number
  weight: number
  credentials: string | null
  config: string | null
  updated_at: string
}

/**
 * The capability model, in one machine-readable place.
 *
 * The wizard, the composer's size warnings and the docs all need to answer the
 * same questions — what does this transport require, what DNS does it want, how
 * big a message will it take, does it report events — and three copies of those
 * answers is how the DKIM record ended up describing a key nothing signed with.
 */
export const CATALOG: Record<
  Name,
  {
    label: string
    /** Credential fields, in the order a form should render them. */
    fields: { key: string; label: string; secret: boolean; required: boolean; help?: string }[]
    /** Non-secret settings stored alongside them. */
    config: { key: string; label: string; help?: string }[]
    maxMessageBytes: number
    reportsEvents: boolean
    /** Whether this transport can create the sending identity for us. */
    managesIdentity: boolean
    /** The honest caveats. Rendered, not hidden in a docs page. */
    caveats: string[]
    docs: string
  }
> = {
  cloudflare: {
    label: 'Cloudflare Email Service',
    fields: [
      {
        key: 'account_id',
        label: 'Account ID',
        secret: false,
        required: false,
        help: 'Only needed for the REST path. With the send_email binding, leave both blank.',
      },
      { key: 'api_token', label: 'API token', secret: true, required: false },
    ],
    config: [],
    maxMessageBytes: 5 * 1024 * 1024,
    reportsEvents: true,
    managesIdentity: true,
    caveats: [
      'Cloudflare writes the DNS records itself when you onboard a domain in its dashboard, so this product has none for you to copy.',
      'Messages to destinations you have not verified are capped at 5 MiB.',
      'The domain must already be on the same Cloudflare account.',
    ],
    docs: '/docs#providers',
  },
  ses: {
    label: 'Amazon SES',
    fields: [
      { key: 'access_key_id', label: 'Access key ID', secret: false, required: true },
      { key: 'secret_access_key', label: 'Secret access key', secret: true, required: true },
    ],
    config: [
      { key: 'region', label: 'Region', help: 'e.g. us-east-1. SES identities are per-region.' },
      {
        key: 'configuration_set',
        label: 'Configuration set',
        help: 'Optional; needed for SNS events.',
      },
    ],
    maxMessageBytes: 40 * 1024 * 1024,
    reportsEvents: true,
    managesIdentity: true,
    caveats: [
      'A new SES account is in the sandbox: it can only send to addresses you have verified, at 200 messages a day. Ask AWS for production access before you rely on it.',
      'Events arrive over SNS, which needs a configuration set and a subscription pointed at this instance.',
    ],
    docs: '/docs#providers',
  },
  resend: {
    label: 'Resend',
    fields: [{ key: 'api_key', label: 'API key', secret: true, required: true }],
    config: [],
    maxMessageBytes: 40 * 1024 * 1024,
    reportsEvents: true,
    managesIdentity: true,
    caveats: [
      'Resend verifies domains through its own API, so the records shown for a Resend domain are theirs, fetched live — not ours.',
    ],
    docs: '/docs#providers',
  },
  smtp: {
    label: 'SMTP relay',
    fields: [
      { key: 'username', label: 'Username', secret: false, required: false },
      { key: 'password', label: 'Password', secret: true, required: false },
    ],
    config: [
      { key: 'host', label: 'Host' },
      { key: 'port', label: 'Port', help: '587 for STARTTLS, 465 for implicit TLS.' },
      { key: 'secure', label: 'Implicit TLS', help: 'true for port 465.' },
    ],
    maxMessageBytes: 25 * 1024 * 1024,
    reportsEvents: false,
    managesIdentity: false,
    caveats: [
      'A raw relay reports nothing back, so delivery state comes from DSN parsing alone: sent is the last thing this transport can tell you for certain.',
      'This is the transport where our own DKIM signature does the work, so the DKIM record has to be published and correct.',
    ],
    docs: '/docs#smtp',
  },
}

const toPublic = (row: ConfigRow, credentials: Record<string, string>) => ({
  object: 'provider' as const,
  id: row.id,
  provider: row.provider,
  enabled: Boolean(row.enabled),
  priority: row.priority,
  weight: row.weight,
  // Which fields are set — never their values. A form renders "•••• set" and
  // asks for a replacement; there is no read path for a secret anywhere here.
  credentials_set: Object.entries(credentials)
    .filter(([, value]) => typeof value === 'string' && value !== '')
    .map(([key]) => key),
  config: row.config ? (JSON.parse(row.config) as Record<string, unknown>) : {},
  updated_at: row.updated_at,
})

providers.get('/catalog', async (c) => {
  const ctx = c.get('ctx')
  return json({
    object: 'list',
    data: NAMES.map((name) => ({
      object: 'provider_catalog_entry' as const,
      provider: name,
      ...CATALOG[name],
      /** Whether the deployment's environment could already supply this one. */
      available_from_environment: environmentSupplies(name, ctx),
    })),
    has_more: false,
    next_cursor: null,
  })
})

providers.get('/', async (c) => {
  const ctx = c.get('ctx')
  const rows = await ctx.sql
    .prepare(
      `SELECT id, provider, enabled, priority, weight, credentials, config, updated_at
         FROM provider_configs WHERE workspace_id = ? ORDER BY priority`,
    )
    .bind(ctx.workspace.id)
    .all<ConfigRow>()

  const data = []
  for (const row of rows.results) {
    const credentials = row.credentials ? await decryptCredentials(row.credentials, ctx.env) : {}
    data.push(toPublic(row, credentials))
  }

  return json({
    object: 'list',
    data,
    has_more: false,
    next_cursor: null,
    /**
     * The honest bit. When a workspace has configured nothing, sending does not
     * stop — it falls back to the deployment's environment variables — and an
     * empty list that did not say so read as "sending is not set up".
     */
    environment_fallback: data.every((row) => !row.enabled)
      ? NAMES.filter((name) => environmentSupplies(name, ctx))
      : [],
    /**
     * The transport a send would actually leave through if nothing here is
     * enabled — Cloudflare Email unless the deployment names another. Computed
     * from the same order the router uses rather than restated, so the screen
     * cannot drift from the behaviour it describes. `null` means this deployment
     * can stand up no transport at all, and only Test mode will send.
     */
    default_provider: await resolveDefaultProvider(ctx.env),
  })
})

const PutBody = z.object({
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  weight: z.number().int().min(0).max(1000).optional(),
  credentials: z.record(z.string().max(64), z.string().max(4096)).optional(),
  config: z
    .record(z.string().max(64), z.union([z.string().max(500), z.number(), z.boolean()]))
    .optional(),
})

providers.put('/:name', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'settings:write')
  requireRole(ctx.actor, 'owner')

  const name = parseName(c.req.param('name'))
  const body = PutBody.parse(await c.req.json())

  const existing = await ctx.sql
    .prepare(
      `SELECT id, provider, enabled, priority, weight, credentials, config, updated_at
         FROM provider_configs WHERE workspace_id = ? AND provider = ?`,
    )
    .bind(ctx.workspace.id, name)
    .first<ConfigRow>()

  // A partial update must not wipe the secrets it did not mention: the form
  // sends only the fields somebody retyped, and everything else is merged onto
  // what is already stored.
  const current = existing?.credentials
    ? await decryptCredentials(existing.credentials, ctx.env)
    : {}
  const merged = { ...current }
  for (const [key, value] of Object.entries(body.credentials ?? {})) {
    if (value === '') delete merged[key]
    else merged[key] = value
  }

  const config = {
    ...(existing?.config ? JSON.parse(existing.config) : {}),
    ...(body.config ?? {}),
  }
  const now = new Date().toISOString()
  const id = existing?.id ?? newId('providerConfig')
  const ciphertext =
    Object.keys(merged).length > 0 ? await encryptCredentials(merged, ctx.env) : null

  await ctx.sql
    .prepare(
      `INSERT INTO provider_configs
         (id, workspace_id, provider, enabled, priority, weight, credentials, config, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(workspace_id, provider) DO UPDATE SET
         enabled = excluded.enabled,
         priority = excluded.priority,
         weight = excluded.weight,
         credentials = excluded.credentials,
         config = excluded.config,
         updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      ctx.workspace.id,
      name,
      // Bound as an integer: `node:sqlite` refuses a JavaScript boolean, and
      // this is the one column a form actually sends as one.
      body.enabled === undefined ? (existing?.enabled ?? 1) : body.enabled ? 1 : 0,
      body.priority ?? existing?.priority ?? 100,
      body.weight ?? existing?.weight ?? 100,
      ciphertext,
      JSON.stringify(config),
      // `created_at` is only used by the INSERT half; the upsert never updates it.
      now,
      now,
    )
    .run()

  const saved = await ctx.sql
    .prepare(
      `SELECT id, provider, enabled, priority, weight, credentials, config, updated_at
         FROM provider_configs WHERE workspace_id = ? AND provider = ?`,
    )
    .bind(ctx.workspace.id, name)
    .first<ConfigRow>()
  if (!saved) throw apiError('not_found')
  return json(toPublic(saved, merged))
})

/**
 * `POST /v1/providers/:name/test` — the preflight, reported honestly.
 *
 * `verify()` has three answers and all three reach the screen unchanged.
 * `unknown` stays `unknown`: Cloudflare's `send_email` binding is present on
 * every Worker that declares it, configured or not, so turning its presence
 * into `ok` told operators their Email Service was ready when the first send
 * would fail.
 */
providers.post('/:name/test', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'settings:write')
  requireRole(ctx.actor, 'developer')

  const name = parseName(c.req.param('name'))
  const provider = await buildProviderFor(ctx.sql, ctx.workspace.id, name, ctx.env)
  if (!provider) {
    return json({
      object: 'provider_test',
      provider: name,
      status: 'failed',
      detail:
        'Nothing is configured for this transport, here or in the environment, so there is nothing to check.',
    })
  }

  if (!provider.verify) {
    return json({
      object: 'provider_test',
      provider: name,
      status: 'unknown',
      detail: 'This transport has no cheap liveness check. The first send is the check.',
    })
  }

  const result = await provider.verify()
  return json({
    object: 'provider_test',
    provider: name,
    status: result.status,
    detail: result.detail ?? null,
    reports_events: provider.reportsEvents,
    max_message_bytes: provider.limits.maxMessageBytes,
  })
})

providers.delete('/:name', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'settings:write')
  requireRole(ctx.actor, 'owner')
  const name = parseName(c.req.param('name'))
  await ctx.sql
    .prepare('DELETE FROM provider_configs WHERE workspace_id = ? AND provider = ?')
    .bind(ctx.workspace.id, name)
    .run()
  return json({ object: 'provider', provider: name, deleted: true })
})

function parseName(raw: string): Name {
  const found = NAMES.find((name) => name === raw)
  if (!found) {
    throw apiError('validation_error', {
      message: `Unknown transport. One of: ${NAMES.join(', ')}.`,
      param: 'name',
    })
  }
  return found
}

/** Whether the deployment's variables alone could stand this transport up. */
function environmentSupplies(name: Name, ctx: Ctx): boolean {
  const env = ctx.env
  switch (name) {
    case 'cloudflare':
      return Boolean(env.SEND_EMAIL || (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN))
    case 'ses':
      return Boolean(env.SES_ACCESS_KEY_ID && env.SES_SECRET_ACCESS_KEY)
    case 'resend':
      return Boolean(env.RESEND_API_KEY)
    case 'smtp':
      return Boolean(env.SMTP_HOST)
  }
}

export { providers }
