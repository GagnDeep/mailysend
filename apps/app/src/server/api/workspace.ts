import { apiError } from '@mailysend/contracts'
import { hashApiKey, newId } from '@mailysend/core'
import { z } from 'zod'
import { requireRole } from '../auth.ts'
import { acceptEmail } from '../send/accept.ts'
import { type App, createRouter, json, withContext } from './base.ts'

/**
 * `/v1/workspace` — settings, members and invites.
 *
 * Settings live in the `settings` key/value table rather than as columns on
 * `workspaces`, because they are read as a block by exactly one screen and the
 * set of them grows with every feature. Columns would mean a migration per
 * toggle; a typed read/write pair here means the shape is still checked.
 */
const workspace: App = createRouter()

workspace.use('*', withContext())

const ROLES = ['owner', 'developer', 'marketer', 'read_only'] as const

/**
 * Defaults, and the only place they are written down.
 *
 * A missing row means "never configured", not "off" — so reads fall back here
 * rather than to a zero value, and a fresh workspace behaves like a configured
 * one instead of like a broken one.
 */
const SETTING_DEFAULTS = {
  default_from: null as string | null,
  default_reply_to: null as string | null,
  open_tracking: true,
  click_tracking: true,
  provider: 'cloudflare' as 'cloudflare' | 'ses' | 'resend' | 'smtp',
  failover_provider: null as 'cloudflare' | 'ses' | 'resend' | 'smtp' | null,
  log_retention_days: 30,
  raw_message_retention_days: 7,
  suppression_sync: true,
}

const Provider = z.enum(['cloudflare', 'ses', 'resend', 'smtp'])

const UpdateSettings = z.object({
  name: z.string().min(1).max(120).optional(),
  default_from: z.string().max(320).nullable().optional(),
  default_reply_to: z.string().max(320).nullable().optional(),
  open_tracking: z.boolean().optional(),
  click_tracking: z.boolean().optional(),
  provider: Provider.optional(),
  failover_provider: Provider.nullable().optional(),
  // Retention is billed storage, so the ceiling is stated rather than implied.
  log_retention_days: z.number().int().min(1).max(2555).optional(),
  raw_message_retention_days: z.number().int().min(0).max(2555).optional(),
  suppression_sync: z.boolean().optional(),
})

async function readSettings(ctx: {
  sql: { prepare(q: string): { bind(...a: unknown[]): { all<T>(): Promise<{ results: T[] }> } } }
  workspace: { id: string; name: string }
}) {
  const { results } = await ctx.sql
    .prepare('SELECT key, value FROM settings WHERE workspace_id = ?')
    .bind(ctx.workspace.id)
    .all<{ key: string; value: string | null }>()

  const stored = new Map(results.map((row) => [row.key, row.value]))
  const read = <K extends keyof typeof SETTING_DEFAULTS>(key: K): (typeof SETTING_DEFAULTS)[K] => {
    const raw = stored.get(key)
    if (raw === undefined || raw === null) return SETTING_DEFAULTS[key]
    try {
      return JSON.parse(raw) as (typeof SETTING_DEFAULTS)[K]
    } catch {
      // A hand-edited row should not take the settings screen down.
      return SETTING_DEFAULTS[key]
    }
  }

  // Stored raw rather than JSON-encoded, because `PUT /sending-domain` writes
  // an id and not a setting document; the quote strip is what makes both forms
  // readable if one was ever written the other way.
  const defaultSendingDomain = stored.get('default_sending_domain')?.replace(/^"|"$/g, '') ?? null

  return {
    name: ctx.workspace.name,
    default_sending_domain: defaultSendingDomain,
    default_from: read('default_from'),
    default_reply_to: read('default_reply_to'),
    open_tracking: read('open_tracking'),
    click_tracking: read('click_tracking'),
    provider: read('provider'),
    failover_provider: read('failover_provider'),
    log_retention_days: read('log_retention_days'),
    raw_message_retention_days: read('raw_message_retention_days'),
    suppression_sync: read('suppression_sync'),
  }
}

workspace.get('/settings', async (c) => json(await readSettings(c.get('ctx') as never)))

workspace.patch('/settings', async (c) => {
  const ctx = c.get('ctx')
  requireRole(ctx.actor, 'developer')
  const patch = UpdateSettings.parse(await c.req.json())
  const now = new Date().toISOString()

  if (patch.name !== undefined) {
    await ctx.sql
      .prepare('UPDATE workspaces SET name = ? WHERE id = ?')
      .bind(patch.name, ctx.workspace.id)
      .run()
    ctx.workspace.name = patch.name
  }

  for (const [key, value] of Object.entries(patch)) {
    if (key === 'name' || value === undefined) continue
    await ctx.sql
      .prepare(
        `INSERT INTO settings (workspace_id, key, value, updated_at) VALUES (?,?,?,?)
         ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(ctx.workspace.id, key, JSON.stringify(value), now)
      .run()
  }

  return json(await readSettings(ctx as never))
})

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

workspace.get('/members', async (c) => {
  const ctx = c.get('ctx')
  const { results } = await ctx.sql
    .prepare(
      `SELECT u.id, u.email, u.name, m.role, m.created_at,
              (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = ?
        ORDER BY m.created_at`,
    )
    .bind(ctx.workspace.id)
    .all<{
      id: string
      email: string
      name: string | null
      role: string
      created_at: string
      last_seen_at: string | null
    }>()
  return json({ object: 'list', data: results, has_more: false, next_cursor: null })
})

workspace.patch('/members/:id', async (c) => {
  const ctx = c.get('ctx')
  requireRole(ctx.actor, 'owner')
  const { role } = z.object({ role: z.enum(ROLES) }).parse(await c.req.json())
  const id = c.req.param('id')

  // The last owner cannot demote themselves. A workspace with no owner has no
  // way to add one back, and the only recovery is editing the database by hand.
  if (role !== 'owner') {
    const owners = await ctx.sql
      .prepare(
        `SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ? AND role = 'owner' AND user_id != ?`,
      )
      .bind(ctx.workspace.id, id)
      .first<{ n: number }>()
    if ((owners?.n ?? 0) === 0) {
      throw apiError('validation_error', {
        message: 'This is the only owner. Promote someone else before changing this role.',
        param: 'role',
      })
    }
  }

  const result = await ctx.sql
    .prepare('UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?')
    .bind(role, ctx.workspace.id, id)
    .run()
  if (result.meta.changes === 0) throw apiError('not_found')

  const row = await ctx.sql
    .prepare(
      `SELECT u.id, u.email, u.name, m.role, m.created_at
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = ? AND m.user_id = ?`,
    )
    .bind(ctx.workspace.id, id)
    .first()
  return json(row)
})

workspace.delete('/members/:id', async (c) => {
  const ctx = c.get('ctx')
  requireRole(ctx.actor, 'owner')
  const id = c.req.param('id')

  const owners = await ctx.sql
    .prepare(
      `SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ? AND role = 'owner' AND user_id != ?`,
    )
    .bind(ctx.workspace.id, id)
    .first<{ n: number }>()
  if ((owners?.n ?? 0) === 0) {
    throw apiError('validation_error', {
      message: 'Removing the only owner would leave the workspace unreachable.',
    })
  }

  await ctx.sql
    .prepare('DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?')
    .bind(ctx.workspace.id, id)
    .run()
  // Their sessions go with the membership, or a removed member keeps the
  // dashboard open until their cookie expires a month from now.
  await ctx.sql
    .prepare('DELETE FROM sessions WHERE user_id = ? AND workspace_id = ?')
    .bind(id, ctx.workspace.id)
    .run()
  return json({ object: 'member', id, deleted: true })
})

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

workspace.get('/invites', async (c) => {
  const ctx = c.get('ctx')
  const { results } = await ctx.sql
    .prepare(
      `SELECT id, email, role, created_at, expires_at FROM invites
        WHERE workspace_id = ? AND accepted_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC`,
    )
    .bind(ctx.workspace.id, new Date().toISOString())
    .all<{ id: string; email: string; role: string; created_at: string; expires_at: string }>()
  return json({ object: 'list', data: results, has_more: false, next_cursor: null })
})

workspace.post('/invites', async (c) => {
  const ctx = c.get('ctx')
  requireRole(ctx.actor, 'owner')
  const body = z
    .object({ email: z.string().email().max(320), role: z.enum(ROLES) })
    .parse(await c.req.json())
  const email = body.email.trim().toLowerCase()

  const now = Date.now()
  const id = newId('user')
  // Only the hash is stored, exactly as for API keys: an invite token is a
  // credential that grants workspace access, and a leaked `invites` table
  // should not be a way in.
  const token = `msi_${crypto.randomUUID().replace(/-/g, '')}`
  const expiresAt = new Date(now + 7 * 24 * 60 * 60_000).toISOString()

  await ctx.sql
    .prepare(
      `INSERT INTO invites (id, workspace_id, email, role, token_hash, expires_at, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .bind(
      id,
      ctx.workspace.id,
      email,
      body.role,
      await hashApiKey(token),
      expiresAt,
      new Date(now).toISOString(),
    )
    .run()

  // Sent through our own send path, like every other message this deployment
  // produces — an invite that bypassed it would not appear in the logs the
  // operator is being asked to trust.
  const domain = await ctx.sql
    .prepare(
      `SELECT name FROM domains WHERE workspace_id = ? AND status = 'verified' ORDER BY created_at LIMIT 1`,
    )
    .bind(ctx.workspace.id)
    .first<{ name: string }>()

  if (domain) {
    const link = `${ctx.publicUrl}/sign-in?invite=${encodeURIComponent(token)}`
    ctx.background(
      acceptEmail(ctx, {
        from: `MailySend <invites@${domain.name}>`,
        to: [email],
        subject: `You have been invited to ${ctx.workspace.name} on MailySend`,
        text:
          `You have been added to ${ctx.workspace.name} as ${body.role.replace('_', ' ')}.\n\n` +
          `Accept the invitation: ${link}\n\nThe link expires in seven days.\n`,
        tags: [{ name: 'kind', value: 'invite' }],
      }).catch((err) => {
        console.error('[workspace] invite email failed', err)
      }),
    )
  }

  return json(
    { id, email, role: body.role, created_at: new Date(now).toISOString(), expires_at: expiresAt },
    201,
  )
})

workspace.delete('/invites/:id', async (c) => {
  const ctx = c.get('ctx')
  requireRole(ctx.actor, 'owner')
  const id = c.req.param('id')
  const result = await ctx.sql
    .prepare('DELETE FROM invites WHERE id = ? AND workspace_id = ?')
    .bind(id, ctx.workspace.id)
    .run()
  if (result.meta.changes === 0) throw apiError('not_found')
  return json({ object: 'invite', id, deleted: true })
})

/**
 * Deleting a workspace is refused on a self-hosted instance.
 *
 * There is exactly one workspace there, every table is keyed by it, and
 * removing it would leave a running deployment whose every request 404s. The
 * honest way to delete a self-hosted MailySend is to delete the deployment.
 */
workspace.delete('/:id', async (c) => {
  const ctx = c.get('ctx')
  requireRole(ctx.actor, 'owner')
  if (ctx.env.MS_MODE === 'single') {
    throw apiError('validation_error', {
      message:
        'This deployment has a single workspace. Delete the deployment itself to remove the data.',
    })
  }
  if (c.req.param('id') !== ctx.workspace.id) throw apiError('not_found')
  throw apiError('not_implemented')
})

export { workspace }

// ---------------------------------------------------------------------------
// Domains: the one you send from, and the one you are reached on
// ---------------------------------------------------------------------------

/**
 * `PUT /v1/workspace/sending-domain` — which verified domain is the default.
 *
 * Auth mail — sign-in codes, invites — used to go out from
 * `ORDER BY created_at LIMIT 1`, so the first domain ever added silently became
 * the identity of every system message and stayed that way after it was
 * retired. This makes it a choice.
 */
workspace.put('/sending-domain', async (c) => {
  const ctx = c.get('ctx')
  requireRole(ctx.actor, 'developer')
  const body = z
    .object({ domain_id: z.string().min(1).max(64).nullable() })
    .parse(await c.req.json())

  if (body.domain_id) {
    const row = await ctx.sql
      .prepare('SELECT id, status FROM domains WHERE workspace_id = ? AND id = ?')
      .bind(ctx.workspace.id, body.domain_id)
      .first<{ id: string; status: string }>()
    if (!row) throw apiError('not_found')
    // An unverified default is a default that cannot send, which is a worse
    // failure than having none: the fallback at least picks something that works.
    if (row.status !== 'verified') {
      throw apiError('validation_error', {
        message: 'Only a verified domain can be the default sending domain.',
        param: 'domain_id',
      })
    }
  }

  const now = new Date().toISOString()
  if (body.domain_id) {
    await ctx.sql
      .prepare(
        `INSERT INTO settings (workspace_id, key, value, updated_at) VALUES (?, 'default_sending_domain', ?, ?)
         ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(ctx.workspace.id, body.domain_id, now)
      .run()
  } else {
    await ctx.sql
      .prepare(`DELETE FROM settings WHERE workspace_id = ? AND key = 'default_sending_domain'`)
      .bind(ctx.workspace.id)
      .run()
  }

  return json({ object: 'workspace', default_sending_domain: body.domain_id })
})

const InstanceDomain = z.object({
  hostname: z
    .string()
    .min(3)
    .max(253)
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i,
      'must be a hostname',
    ),
})

/**
 * `PUT /v1/workspace/instance-domain` — the hostname this instance answers on.
 *
 * Everything the product mints is keyed to one value: tracking pixels,
 * unsubscribe links, canonical tags, the `Secure` cookie decision, and — most
 * consequentially — the WebAuthn relying-party id. So this is one write, and it
 * pins `MS_PUBLIC_URL` so the learn-from-the-request behaviour stops second
 * -guessing it.
 *
 * What it deliberately does *not* do is attach the domain to the Worker. That
 * happens in Cloudflare's control plane, needs the script name and zone this
 * code has no reliable way to know, and a half-working button that silently
 * does nothing is exactly the class of thing this release exists to remove. So
 * the response carries the two steps to take and `GET` probes whether they
 * worked.
 *
 * Existing passkeys will not work on the new hostname — WebAuthn binds them to
 * the old one. That is stated in the response rather than discovered later, and
 * `previous_public_url` on `/v1/instance` keeps saying so afterwards.
 */
workspace.put('/instance-domain', async (c) => {
  const ctx = c.get('ctx')
  requireRole(ctx.actor, 'owner')
  const body = InstanceDomain.parse(await c.req.json())
  const hostname = body.hostname.toLowerCase()
  const target = `https://${hostname}`

  const { PUBLIC_URL_KEY, PUBLIC_URL_PINNED_KEY, PREVIOUS_URL_KEY, writeInstanceSetting } =
    await import('../bootstrap.ts')
  const current = ctx.env.MS_PUBLIC_URL
  const instanceSql = ctx.tenancy.db('')

  if (current && current !== target)
    await writeInstanceSetting(instanceSql, PREVIOUS_URL_KEY, current)
  await writeInstanceSetting(instanceSql, PUBLIC_URL_KEY, target)
  // Explicit beats learned, permanently. Without this the next request that
  // arrives on the old `*.workers.dev` hostname would move the instance back.
  await writeInstanceSetting(instanceSql, PUBLIC_URL_PINNED_KEY, '1')

  const credentials = await ctx.sql
    .prepare('SELECT COUNT(*) AS n FROM webauthn_credentials WHERE workspace_id = ?')
    .bind(ctx.workspace.id)
    .first<{ n: number }>()

  return json({
    object: 'instance_domain',
    hostname,
    public_url: target,
    previous_public_url: current === target ? null : current,
    passkeys_to_reregister: credentials?.n ?? 0,
    next_steps: [
      `In Cloudflare, open Workers & Pages → your Worker → Settings → Domains & Routes, and add ${hostname} as a custom domain.`,
      `Cloudflare creates the DNS record for you when the zone is on the same account. If it is not, point ${hostname} at the Worker with a CNAME first.`,
      'Then reload this page on the new hostname and register a passkey there — the ones you have are bound to the old host.',
    ],
  })
})

/** `GET /v1/workspace/instance-domain` — has it actually come up? */
workspace.get('/instance-domain', async (c) => {
  const ctx = c.get('ctx')
  const target = ctx.env.MS_PUBLIC_URL
  let live = false
  let detail = 'not checked'
  try {
    const probe = await fetch(`${target.replace(/\/$/, '')}/v1/health`, {
      signal: AbortSignal.timeout(5_000),
      headers: { accept: 'application/json' },
    })
    live = probe.ok
    detail = probe.ok ? 'responding' : `HTTP ${probe.status}`
  } catch (err) {
    // A hostname that does not resolve yet is the expected state right after
    // this is set, not an error worth a 500.
    detail = err instanceof Error ? err.message : 'unreachable'
  }
  return json({ object: 'instance_domain', public_url: target, live, detail })
})
