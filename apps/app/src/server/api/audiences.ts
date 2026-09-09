import { apiError, CreateAudienceRequest } from '@mailysend/contracts'
import { newId } from '@mailysend/core'
import { requireRole, requireScope } from '../auth.ts'
import { type App, createRouter, json, page, parseLimit, withContext } from './base.ts'
import { contactHandlers } from './contacts.ts'

/**
 * `/v1/audiences` — Resend-compatible lists of contacts.
 *
 * The nested contact routes live here rather than in `contacts.ts` because
 * Resend's SDK addresses contacts as `/audiences/:audience_id/contacts/:id`
 * while its own docs also expose the flat form. Both spellings run the same
 * handlers, so there is one implementation and two spellings of the URL.
 */

const audiences: App = createRouter()

audiences.use('*', withContext())

audiences.post('/', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'audiences:write')
  requireRole(ctx.actor, 'marketer')
  const { name } = CreateAudienceRequest.parse(await c.req.json())

  const id = newId('audience')
  const createdAt = new Date().toISOString()
  await ctx.sql
    .prepare(
      `INSERT INTO audiences (id, workspace_id, name, contact_count, created_at) VALUES (?, ?, ?, 0, ?)`,
    )
    .bind(id, ctx.workspace.id, name, createdAt)
    .run()

  return json({ object: 'audience', id, name, created_at: createdAt, contact_count: 0 }, 201)
})

audiences.get('/', async (c) => {
  const ctx = c.get('ctx')
  const limit = parseLimit(c.req.query('limit'))
  const cursor = c.req.query('cursor')

  const rows = await ctx.sql
    .prepare(
      `SELECT id, name, contact_count, created_at
         FROM audiences
        WHERE workspace_id = ? ${cursor ? 'AND id < ?' : ''}
        ORDER BY id DESC LIMIT ?`,
    )
    .bind(ctx.workspace.id, ...(cursor ? [cursor] : []), limit + 1)
    .all<AudienceRow>()

  return json(page(rows.results.map(toAudience), limit))
})

/**
 * The single-audience read counts contacts live.
 *
 * `audiences.contact_count` is a denormalised counter maintained by contact
 * writes and is what the list endpoint shows; a bulk import that failed halfway
 * can leave it behind, and the detail view is the one place cheap enough to
 * tell the truth.
 */
audiences.get('/:id', async (c) => {
  const ctx = c.get('ctx')
  const row = await ctx.sql
    .prepare(
      'SELECT id, name, contact_count, created_at FROM audiences WHERE id = ? AND workspace_id = ?',
    )
    .bind(c.req.param('id'), ctx.workspace.id)
    .first<AudienceRow>()
  if (!row) throw apiError('not_found')

  const counted = await ctx.sql
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN unsubscribed = 1 THEN 1 ELSE 0 END) AS unsubscribed
         FROM contacts WHERE workspace_id = ? AND audience_id = ?`,
    )
    .bind(ctx.workspace.id, row.id)
    .first<{ total: number; unsubscribed: number | null }>()

  const total = Number(counted?.total ?? 0)
  if (total !== row.contact_count) {
    ctx.background(
      ctx.sql
        .prepare('UPDATE audiences SET contact_count = ? WHERE id = ? AND workspace_id = ?')
        .bind(total, row.id, ctx.workspace.id)
        .run(),
    )
  }

  return json({
    ...toAudience(row),
    contact_count: total,
    unsubscribed_count: Number(counted?.unsubscribed ?? 0),
  })
})

audiences.patch('/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'audiences:write')
  requireRole(ctx.actor, 'marketer')
  const { name } = CreateAudienceRequest.parse(await c.req.json())

  const res = await ctx.sql
    .prepare('UPDATE audiences SET name = ? WHERE id = ? AND workspace_id = ?')
    .bind(name, c.req.param('id'), ctx.workspace.id)
    .run()
  if (res.meta.changes === 0) throw apiError('not_found')

  return json({ object: 'audience', id: c.req.param('id'), name })
})

/**
 * Deleting an audience takes its contacts with it, so anything that resolves
 * recipients through it has to be gone first. Refusing is the only honest
 * answer: a broadcast whose audience vanished cannot be re-sent, re-counted or
 * explained after the fact.
 */
audiences.delete('/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'audiences:write')
  requireRole(ctx.actor, 'developer')
  const id = c.req.param('id')

  const audience = await ctx.sql
    .prepare('SELECT id FROM audiences WHERE id = ? AND workspace_id = ?')
    .bind(id, ctx.workspace.id)
    .first<{ id: string }>()
  if (!audience) throw apiError('not_found')

  const deps = await ctx.sql
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM broadcasts WHERE workspace_id = ?1 AND audience_id = ?2) AS broadcasts,
         (SELECT COUNT(*) FROM segments WHERE workspace_id = ?1 AND audience_id = ?2) AS segments,
         (SELECT COUNT(*) FROM automation_triggers
           WHERE workspace_id = ?1 AND json_extract(config, '$.audience_id') = ?2) AS automations`,
    )
    .bind(ctx.workspace.id, id)
    .first<{ broadcasts: number; segments: number; automations: number }>()

  const blocking = [
    [Number(deps?.broadcasts ?? 0), 'broadcast'],
    [Number(deps?.segments ?? 0), 'segment'],
    [Number(deps?.automations ?? 0), 'automation'],
  ] as const
  const named = blocking
    .filter(([count]) => count > 0)
    .map(([count, noun]) => `${count} ${noun}${count === 1 ? '' : 's'}`)
  if (named.length > 0) {
    // There is no generic `resource_in_use` code in the error table; this is the
    // 409 whose public `name` (`invalid_parameter`) fits, and the message names
    // the dependency because that is what the caller has to act on.
    throw apiError('contact_already_exists', {
      message: `This audience is still referenced by ${named.join(', ')}. Delete or repoint them first.`,
    })
  }

  await ctx.sql.batch([
    ctx.sql
      .prepare(
        `DELETE FROM contact_dirty WHERE workspace_id = ?1 AND contact_id IN
           (SELECT id FROM contacts WHERE workspace_id = ?1 AND audience_id = ?2)`,
      )
      .bind(ctx.workspace.id, id),
    ctx.sql
      .prepare('DELETE FROM contacts WHERE workspace_id = ? AND audience_id = ?')
      .bind(ctx.workspace.id, id),
    ctx.sql
      .prepare('DELETE FROM contact_fields WHERE workspace_id = ? AND audience_id = ?')
      .bind(ctx.workspace.id, id),
    ctx.sql
      .prepare('DELETE FROM audiences WHERE id = ? AND workspace_id = ?')
      .bind(id, ctx.workspace.id),
  ])

  return json({ object: 'audience', id, deleted: true })
})

audiences.post('/:audience_id/contacts', contactHandlers.create)
audiences.get('/:audience_id/contacts', contactHandlers.list)
audiences.get('/:audience_id/contacts/:id', contactHandlers.get)
audiences.patch('/:audience_id/contacts/:id', contactHandlers.update)
audiences.delete('/:audience_id/contacts/:id', contactHandlers.remove)

interface AudienceRow {
  id: string
  name: string
  contact_count: number
  created_at: string
}

const toAudience = (row: AudienceRow) => ({
  object: 'audience' as const,
  id: row.id,
  name: row.name,
  created_at: row.created_at,
  contact_count: row.contact_count,
})

export { audiences }
