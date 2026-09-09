import { apiError, CreateSegmentRequest } from '@mailysend/contracts'
import { doName, newId } from '@mailysend/core'
import {
  compile,
  countSegment,
  describe,
  parse,
  previewSegment,
  recomputeFull,
  relativeWindows,
  SegmentError,
  type SegmentSpec,
} from '@mailysend/segments'
import { z } from 'zod'
import { requireRole, requireScope } from '../auth.ts'
import type { Ctx } from '../context.ts'
import { type App, createRouter, json, page, parseLimit, withContext } from './base.ts'

/**
 * `/v1/segments` — saved queries over contacts, kept live.
 *
 * Nothing in this file builds SQL from an expression. The source text is handed
 * to `@mailysend/segments`, which binds every user-supplied value and emits
 * identifiers only from its own column registry; that indirection is the entire
 * reason a customer-authored predicate can be run against the contacts table at
 * all, so it is never worked around for convenience.
 */

const segments: App = createRouter()

segments.use('*', withContext())

const PreviewRequest = z.object({
  audience_id: z.string().min(1),
  expression: z.string().min(1).max(4000),
  limit: z.number().int().min(1).max(25).optional(),
})

const UpdateSegmentRequest = CreateSegmentRequest.partial().omit({ audience_id: true })

/** A parse failure is a 422 the author has to see, with the offset they typed it at. */
function parseExpression(expression: string) {
  try {
    return parse(expression)
  } catch (err) {
    if (err instanceof SegmentError) {
      throw apiError('segment_expression_invalid', {
        message: `${err.message} (at character ${err.offset})`,
        param: 'expression',
      })
    }
    throw err
  }
}

segments.post('/', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'segments:write')
  requireRole(ctx.actor, 'marketer')
  const body = CreateSegmentRequest.parse(await c.req.json())
  await requireAudience(ctx, body.audience_id)

  const ast = parseExpression(body.expression)
  const compiled = compile(ast)
  const id = newId('segment')
  const now = new Date().toISOString()

  await ctx.sql
    .prepare(
      `INSERT INTO segments (id, workspace_id, audience_id, name, expression, compiled, depends_on,
                             member_count, computed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    )
    // The AST is stored, not the compiled fragment: a compiled `now - 30d` has
    // today's timestamp baked into its parameters and would be wrong tomorrow.
    .bind(
      id,
      ctx.workspace.id,
      body.audience_id,
      body.name,
      body.expression,
      JSON.stringify(ast),
      JSON.stringify(compiled.dependsOn),
      now,
      now,
    )
    .run()

  await registerForSweep(ctx, { id, audienceId: body.audience_id, expression: body.expression })
  ctx.background(
    computeAndStore(ctx, { id, audienceId: body.audience_id, expression: body.expression }),
  )

  return json(
    {
      object: 'segment',
      id,
      name: body.name,
      audience_id: body.audience_id,
      expression: body.expression,
      description: describe(ast),
      depends_on: compiled.dependsOn,
      member_count: 0,
      computed_at: null,
      created_at: now,
      updated_at: now,
    },
    201,
  )
})

/**
 * `POST /v1/segments/preview` — run an expression that does not exist yet.
 *
 * The English rendering is the point of the endpoint as much as the count is:
 * `not opened_last_30d and created > 90d` is easy to write and easy to
 * misread, and the moment to find out it means something else is before it is
 * saved and mailed to fifty thousand people.
 */
segments.post('/preview', async (c) => {
  const ctx = c.get('ctx')
  const body = PreviewRequest.parse(await c.req.json())
  await requireAudience(ctx, body.audience_id)

  const ast = parseExpression(body.expression)
  const result = await previewSegment(
    ctx.sql,
    ctx.workspace.id,
    body.expression,
    body.audience_id,
    body.limit ?? 25,
  )

  return json({
    object: 'segment_preview',
    audience_id: body.audience_id,
    expression: body.expression,
    description: describe(ast),
    count: result.total,
    contacts: result.contacts,
    depends_on: result.dependsOn,
  })
})

segments.get('/', async (c) => {
  const ctx = c.get('ctx')
  const limit = parseLimit(c.req.query('limit'))
  const cursor = c.req.query('cursor')
  const audienceId = c.req.query('audience_id')

  const rows = await ctx.sql
    .prepare(
      `SELECT id, audience_id, name, expression, depends_on, member_count, computed_at, created_at, updated_at
         FROM segments
        WHERE workspace_id = ?
          ${audienceId ? 'AND audience_id = ?' : ''}
          ${cursor ? 'AND id < ?' : ''}
        ORDER BY id DESC LIMIT ?`,
    )
    .bind(
      ctx.workspace.id,
      ...(audienceId ? [audienceId] : []),
      ...(cursor ? [cursor] : []),
      limit + 1,
    )
    .all<SegmentRow>()

  return json(page(rows.results.map(toSegment), limit))
})

/** The stored count is a recompute artefact; the detail view counts for real. */
segments.get('/:id', async (c) => {
  const ctx = c.get('ctx')
  const row = await loadSegment(ctx, c.req.param('id'))
  const count = await countSegment(ctx.sql, ctx.workspace.id, specOf(row))
  return json({ ...toSegment(row), member_count: count, description: describe(row.expression) })
})

/**
 * Editing the expression invalidates every stored membership row, so the write
 * schedules a full recompute rather than a delta: the delta path only knows how
 * to re-check named contacts, and after an edit the answer changed for all of
 * them at once.
 */
segments.patch('/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'segments:write')
  requireRole(ctx.actor, 'marketer')
  const body = UpdateSegmentRequest.parse(await c.req.json())
  const row = await loadSegment(ctx, c.req.param('id'))

  const expression = body.expression ?? row.expression
  const ast = parseExpression(expression)
  const compiled = compile(ast)
  const now = new Date().toISOString()

  await ctx.sql
    .prepare(
      `UPDATE segments SET name = ?, expression = ?, compiled = ?, depends_on = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ?`,
    )
    .bind(
      body.name ?? row.name,
      expression,
      JSON.stringify(ast),
      JSON.stringify(compiled.dependsOn),
      now,
      row.id,
      ctx.workspace.id,
    )
    .run()

  const spec = { id: row.id, audienceId: row.audience_id, expression }
  await registerForSweep(ctx, spec)
  ctx.background(computeAndStore(ctx, spec))

  return json({
    ...toSegment({ ...row, name: body.name ?? row.name, expression, updated_at: now }),
    description: describe(ast),
  })
})

segments.delete('/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'segments:write')
  requireRole(ctx.actor, 'developer')
  const row = await loadSegment(ctx, c.req.param('id'))

  const deps = await ctx.sql
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM broadcasts WHERE workspace_id = ?1 AND segment_id = ?2) AS broadcasts,
         (SELECT COUNT(*) FROM automation_triggers
           WHERE workspace_id = ?1 AND json_extract(config, '$.segment_id') = ?2) AS automations`,
    )
    .bind(ctx.workspace.id, row.id)
    .first<{ broadcasts: number; automations: number }>()

  const named = [
    [Number(deps?.broadcasts ?? 0), 'broadcast'],
    [Number(deps?.automations ?? 0), 'automation'],
  ]
    .filter(([count]) => Number(count) > 0)
    .map(([count, noun]) => `${count} ${noun}${count === 1 ? '' : 's'}`)
  if (named.length > 0) {
    // No generic `resource_in_use` code exists; this is the 409 whose public
    // name is `invalid_parameter`, and the message names the dependency.
    throw apiError('contact_already_exists', {
      message: `This segment is still referenced by ${named.join(', ')}. Delete or repoint them first.`,
    })
  }

  await ctx.sql.batch([
    ctx.sql
      .prepare('DELETE FROM segment_members WHERE workspace_id = ? AND segment_id = ?')
      .bind(ctx.workspace.id, row.id),
    ctx.sql
      .prepare('DELETE FROM segments WHERE id = ? AND workspace_id = ?')
      .bind(row.id, ctx.workspace.id),
  ])
  await ctx.env.SEGMENT.get(doName('Segment', ctx.workspace.id)).unregister(row.id)

  return json({ object: 'segment', id: row.id, deleted: true })
})

/**
 * A full recompute walks the whole audience, so it is accepted rather than
 * performed: holding the request open for a 400,000-contact audience would time
 * out on both runtimes and tell the caller nothing they cannot poll for.
 */
segments.post('/:id/recompute', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'segments:write')
  requireRole(ctx.actor, 'marketer')
  const row = await loadSegment(ctx, c.req.param('id'))

  ctx.background(computeAndStore(ctx, specOf(row)))
  return json({ object: 'segment', id: row.id, status: 'recomputing' }, 202)
})

async function requireAudience(ctx: Ctx, audienceId: string): Promise<void> {
  const row = await ctx.sql
    .prepare('SELECT id FROM audiences WHERE id = ? AND workspace_id = ?')
    .bind(audienceId, ctx.workspace.id)
    .first<{ id: string }>()
  if (!row)
    throw apiError('not_found', { message: `No audience \`${audienceId}\` in this workspace.` })
}

async function loadSegment(ctx: Ctx, id: string): Promise<SegmentRow> {
  const row = await ctx.sql
    .prepare(
      `SELECT id, audience_id, name, expression, depends_on, member_count, computed_at, created_at, updated_at
         FROM segments WHERE id = ? AND workspace_id = ?`,
    )
    .bind(id, ctx.workspace.id)
    .first<SegmentRow>()
  if (!row) throw apiError('not_found')
  return row
}

/**
 * Registers the segment with the hourly sweep.
 *
 * Only expressions with a relative window need it: `last_open_at > now - 30d`
 * stops matching with no write to the contact at all, so no delta pass can ever
 * notice. An expression without one is registered too, with an empty window
 * list, so that the actor's view stays a complete inventory.
 */
async function registerForSweep(ctx: Ctx, spec: SegmentSpec): Promise<void> {
  const windows = relativeWindows(parse(spec.expression)).map((window) => ({
    field: window.column,
    days: window.ms / 86_400_000,
  }))
  await ctx.env.SEGMENT.get(doName('Segment', ctx.workspace.id)).register({
    segmentId: spec.id,
    workspaceId: ctx.workspace.id,
    audienceId: spec.audienceId,
    timeWindows: windows,
  })
}

async function computeAndStore(ctx: Ctx, spec: SegmentSpec): Promise<void> {
  const result = await recomputeFull(ctx.sql, ctx.workspace.id, spec)
  await ctx.sql
    .prepare(
      'UPDATE segments SET member_count = ?, computed_at = ? WHERE id = ? AND workspace_id = ?',
    )
    .bind(result.matched, new Date().toISOString(), spec.id, ctx.workspace.id)
    .run()
}

interface SegmentRow {
  id: string
  audience_id: string
  name: string
  expression: string
  depends_on: string | null
  member_count: number
  computed_at: string | null
  created_at: string
  updated_at: string
}

const specOf = (row: SegmentRow): SegmentSpec => ({
  id: row.id,
  audienceId: row.audience_id,
  expression: row.expression,
})

const toSegment = (row: SegmentRow) => ({
  object: 'segment' as const,
  id: row.id,
  name: row.name,
  audience_id: row.audience_id,
  expression: row.expression,
  depends_on: row.depends_on ? (JSON.parse(row.depends_on) as string[]) : [],
  member_count: row.member_count,
  computed_at: row.computed_at,
  created_at: row.created_at,
  updated_at: row.updated_at,
})

export { segments }
