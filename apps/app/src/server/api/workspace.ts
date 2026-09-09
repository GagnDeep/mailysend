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

  return {
    name: ctx.workspace.name,
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
