import { apiError, CreateTemplateRequest, SendEmailRequest } from '@mailysend/contracts'
import { newId } from '@mailysend/core'
import {
  AST_VERSION,
  type Engine,
  extractVariables,
  generatePreviewData,
  renderTemplate,
  validateAst,
} from '@mailysend/templates'
import { z } from 'zod'
import { requireRole, requireScope } from '../auth.ts'
import type { Ctx } from '../context.ts'
import { acceptEmail } from '../send/accept.ts'
import { type App, createRouter, json, page, parseLimit, withContext } from './base.ts'

/**
 * `/v1/templates` — stored bodies and their version history.
 *
 * Versions are append-only. A message accepted against version 4 must still
 * render as version 4 an hour later when the consumer picks it up, so editing a
 * template writes a new row and moves a pointer; it never rewrites one. That is
 * also why rollback copies an old version forward instead of resetting the
 * pointer backwards onto a row that in-flight sends are already bound to.
 */

const templates: App = createRouter()

templates.use('*', withContext())

interface TemplateRow {
  id: string
  name: string
  slug: string
  engine: string
  current_version: number
  created_at: string
  updated_at: string
}

interface VersionRow {
  id: string
  template_id: string
  version: number
  subject: string | null
  html: string | null
  text: string | null
  ast: string | null
  variables: string | null
  created_at: string
}

/** The body of a new version. Shared by create and `POST /:id/versions`. */
const VersionBody = z.object({
  subject: z.string().max(998).optional(),
  html: z.string().max(2_000_000).optional(),
  text: z.string().max(2_000_000).optional(),
  ast: z.unknown().optional(),
})

const parseVariables = (raw: string | null): string[] => (raw ? (JSON.parse(raw) as string[]) : [])

const toTemplate = (row: TemplateRow, version?: VersionRow | null) => ({
  object: 'template' as const,
  id: row.id,
  name: row.name,
  slug: row.slug,
  engine: row.engine,
  subject: version?.subject ?? null,
  version: row.current_version,
  published_version: row.current_version,
  created_at: row.created_at,
  updated_at: row.updated_at,
  variables: version ? parseVariables(version.variables) : undefined,
})

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'template'

/**
 * Validates and normalises a version body for one engine.
 *
 * The AST is validated here rather than at render time because a bad AST that
 * reaches the send path fails per-recipient, mid-broadcast; caught here it is a
 * 422 with the exact paths that are wrong, while the author is still looking at
 * the editor.
 */
function prepareVersion(engine: Engine, body: z.infer<typeof VersionBody>) {
  let ast: unknown = null
  if (body.ast !== undefined && body.ast !== null) {
    const result = validateAst(body.ast)
    if (!result.ok) {
      throw apiError('validation_error', {
        message: `The template AST is not valid (expected version ${AST_VERSION}): ${result.errors
          .map((e) => `${e.path || '<root>'}: ${e.message}`)
          .join('; ')}`,
        param: 'ast',
      })
    }
    ast = result.ast
  }
  if (engine === 'jsx-ast' && ast === null) {
    throw apiError('validation_error', {
      message: 'A `jsx-ast` template requires `ast`.',
      param: 'ast',
    })
  }
  if (engine !== 'jsx-ast' && !body.html && !body.text) {
    throw apiError('validation_error', { message: 'Provide `html` or `text`.', param: 'html' })
  }

  const variables = extractVariables({
    engine,
    subject: body.subject ?? null,
    html: body.html ?? null,
    text: body.text ?? null,
    ast,
  })
  return { ast, variables }
}

templates.post('/', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'templates:write')
  requireRole(ctx.actor, 'developer')
  const body = CreateTemplateRequest.parse(await c.req.json())
  const engine = body.engine as Engine
  const prepared = prepareVersion(engine, body)

  const id = newId('template')
  const now = new Date().toISOString()
  const slug = body.slug ?? slugify(body.name)

  const existing = await ctx.sql
    .prepare('SELECT id FROM templates WHERE workspace_id = ? AND slug = ?')
    .bind(ctx.workspace.id, slug)
    .first<{ id: string }>()
  if (existing) {
    throw apiError('validation_error', {
      message: `A template with the slug \`${slug}\` already exists.`,
      param: 'slug',
    })
  }

  await ctx.sql.batch([
    ctx.sql
      .prepare(
        `INSERT INTO templates (id, workspace_id, name, slug, engine, current_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(id, ctx.workspace.id, body.name, slug, engine, now, now),
    ctx.sql
      .prepare(
        `INSERT INTO template_versions
           (id, workspace_id, template_id, version, subject, html, text, ast, variables, created_by, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newId('template'),
        ctx.workspace.id,
        id,
        body.subject ?? null,
        body.html ?? null,
        body.text ?? null,
        prepared.ast ? JSON.stringify(prepared.ast) : null,
        JSON.stringify(prepared.variables),
        ctx.actor.userId ?? null,
        now,
      ),
  ])

  return json({
    object: 'template',
    id,
    name: body.name,
    slug,
    engine,
    subject: body.subject ?? null,
    version: 1,
    published_version: 1,
    variables: prepared.variables,
    created_at: now,
    updated_at: now,
  })
})

templates.get('/', async (c) => {
  const ctx = c.get('ctx')
  const limit = parseLimit(c.req.query('limit'))
  const cursor = c.req.query('cursor')
  const rows = await ctx.sql
    .prepare(
      `SELECT id, name, slug, engine, current_version, created_at, updated_at
         FROM templates
        WHERE workspace_id = ? ${cursor ? 'AND id < ?' : ''}
        ORDER BY id DESC LIMIT ?`,
    )
    .bind(ctx.workspace.id, ...(cursor ? [cursor] : []), limit + 1)
    .all<TemplateRow>()
  return json(
    page(
      rows.results.map((row) => toTemplate(row)),
      limit,
    ),
  )
})

templates.get('/:id', async (c) => {
  const ctx = c.get('ctx')
  const { template, version } = await load(ctx, c.req.param('id'))
  return json({
    ...toTemplate(template, version),
    html: version?.html ?? null,
    text: version?.text ?? null,
    ast: version?.ast ? JSON.parse(version.ast) : null,
  })
})

/** Metadata only. Body changes are versions, not edits — see the file comment. */
templates.patch('/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'templates:write')
  requireRole(ctx.actor, 'developer')
  const body = z
    .object({
      name: z.string().min(1).max(120).optional(),
      slug: z.string().min(1).max(120).optional(),
    })
    .parse(await c.req.json())

  const { template } = await load(ctx, c.req.param('id'))
  const now = new Date().toISOString()
  await ctx.sql
    .prepare(
      'UPDATE templates SET name = ?, slug = ?, updated_at = ? WHERE id = ? AND workspace_id = ?',
    )
    .bind(
      body.name ?? template.name,
      body.slug ?? template.slug,
      now,
      template.id,
      ctx.workspace.id,
    )
    .run()
  return json(
    toTemplate({
      ...template,
      name: body.name ?? template.name,
      slug: body.slug ?? template.slug,
      updated_at: now,
    }),
  )
})

templates.delete('/:id', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'templates:write')
  requireRole(ctx.actor, 'developer')
  const id = c.req.param('id')
  const res = await ctx.sql
    .prepare('DELETE FROM templates WHERE id = ? AND workspace_id = ?')
    .bind(id, ctx.workspace.id)
    .run()
  if (res.meta.changes === 0) throw apiError('not_found')
  await ctx.sql
    .prepare('DELETE FROM template_versions WHERE workspace_id = ? AND template_id = ?')
    .bind(ctx.workspace.id, id)
    .run()
  return json({ object: 'template', id, deleted: true })
})

templates.post('/:id/versions', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'templates:write')
  requireRole(ctx.actor, 'developer')
  const body = VersionBody.parse(await c.req.json())
  const { template } = await load(ctx, c.req.param('id'))
  const engine = template.engine as Engine
  const prepared = prepareVersion(engine, body)

  const version = await nextVersion(ctx, template.id)
  const now = new Date().toISOString()
  await ctx.sql
    .prepare(
      `INSERT INTO template_versions
         (id, workspace_id, template_id, version, subject, html, text, ast, variables, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId('template'),
      ctx.workspace.id,
      template.id,
      version,
      body.subject ?? null,
      body.html ?? null,
      body.text ?? null,
      prepared.ast ? JSON.stringify(prepared.ast) : null,
      JSON.stringify(prepared.variables),
      ctx.actor.userId ?? null,
      now,
    )
    .run()

  // A new version is a draft until it is published: uploading a template from
  // CI must not change what production is sending on the same push.
  return json({
    object: 'template_version',
    template_id: template.id,
    version,
    published: false,
    published_version: template.current_version,
    variables: prepared.variables,
    created_at: now,
  })
})

templates.get('/:id/versions', async (c) => {
  const ctx = c.get('ctx')
  const { template } = await load(ctx, c.req.param('id'))
  const rows = await ctx.sql
    .prepare(
      `SELECT version, subject, variables, created_by, created_at
         FROM template_versions WHERE workspace_id = ? AND template_id = ?
        ORDER BY version DESC LIMIT 100`,
    )
    .bind(ctx.workspace.id, template.id)
    .all<{
      version: number
      subject: string | null
      variables: string | null
      created_by: string | null
      created_at: string
    }>()
  return json({
    object: 'list',
    data: rows.results.map((row) => ({
      object: 'template_version' as const,
      template_id: template.id,
      version: row.version,
      subject: row.subject,
      variables: parseVariables(row.variables),
      published: row.version === template.current_version,
      created_by: row.created_by,
      created_at: row.created_at,
    })),
    has_more: false,
    next_cursor: null,
  })
})

templates.post('/:id/publish', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'templates:write')
  requireRole(ctx.actor, 'developer')
  const body = z
    .object({ version: z.number().int().min(1).optional() })
    .parse(await c.req.json().catch(() => ({})))
  const { template } = await load(ctx, c.req.param('id'))
  const version = body.version ?? (await nextVersion(ctx, template.id)) - 1
  const target = await versionRow(ctx, template.id, version)
  return json(await publish(ctx, template, target))
})

/**
 * Rollback publishes the *content* of an earlier version as a new one.
 *
 * Repointing at the old row would be cheaper and wrong: version numbers are
 * recorded on queued messages and on analytics rows, so reusing one would make
 * two different published states share an identity.
 */
templates.post('/:id/rollback', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'templates:write')
  requireRole(ctx.actor, 'developer')
  const body = z.object({ version: z.number().int().min(1) }).parse(await c.req.json())
  const { template } = await load(ctx, c.req.param('id'))
  const source = await versionRow(ctx, template.id, body.version)

  const version = await nextVersion(ctx, template.id)
  const now = new Date().toISOString()
  await ctx.sql
    .prepare(
      `INSERT INTO template_versions
         (id, workspace_id, template_id, version, subject, html, text, ast, variables, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId('template'),
      ctx.workspace.id,
      template.id,
      version,
      source.subject,
      source.html,
      source.text,
      source.ast,
      source.variables,
      ctx.actor.userId ?? null,
      now,
    )
    .run()

  const created = { ...source, version, created_at: now }
  return json({ ...(await publish(ctx, template, created)), restored_from_version: body.version })
})

/**
 * Preview.
 *
 * The warnings come back with the render because they are the point: a
 * `gmail_clipping` warning means the unsubscribe footer is behind Gmail's "view
 * entire message" link for every recipient, which is the difference between a
 * broadcast that works and one that generates complaints.
 */
templates.post('/:id/preview', async (c) => {
  const ctx = c.get('ctx')
  const body = z
    .object({
      version: z.number().int().min(1).optional(),
      data: z.record(z.string(), z.unknown()).optional(),
    })
    .parse(await c.req.json().catch(() => ({})))
  const { template } = await load(ctx, c.req.param('id'))
  const version = await versionRow(ctx, template.id, body.version ?? template.current_version)

  const variables = parseVariables(version.variables)
  const data = body.data ?? generatePreviewData(variables)
  const rendered = await renderTemplate({
    engine: template.engine as Engine,
    subject: version.subject,
    html: version.html,
    text: version.text,
    ast: version.ast ? JSON.parse(version.ast) : undefined,
    data,
  })

  return json({
    object: 'template_preview',
    template_id: template.id,
    version: version.version,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    warnings: rendered.warnings,
    variables,
    /** Echoed so the author can see which sample values produced this preview. */
    data,
  })
})

/** Up to five addresses: a test send is a sanity check, not a small broadcast. */
templates.post('/:id/test', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'emails:send')
  const body = z
    .object({
      from: z.string().min(3).max(320),
      to: z.array(z.string().min(3).max(320)).min(1).max(5),
      version: z.number().int().min(1).optional(),
      data: z.record(z.string(), z.unknown()).optional(),
    })
    .parse(await c.req.json())

  const { template } = await load(ctx, c.req.param('id'))
  const version = await versionRow(ctx, template.id, body.version ?? template.current_version)
  const variables = parseVariables(version.variables)
  const rendered = await renderTemplate({
    engine: template.engine as Engine,
    subject: version.subject,
    html: version.html,
    text: version.text,
    ast: version.ast ? JSON.parse(version.ast) : undefined,
    data: body.data ?? generatePreviewData(variables),
  })
  if (!rendered.html && !rendered.text) throw apiError('template_render_failed')

  const sent = await Promise.all(
    body.to.map(async (address) => {
      const request = SendEmailRequest.parse({
        from: body.from,
        to: [address],
        subject: rendered.subject || `[test] ${template.name}`,
        html: rendered.html || undefined,
        text: rendered.text || undefined,
        // A test send must reach the tester even if they bounced last week.
        ignore_suppression: true,
        tags: [{ name: 'ms_template_test', value: template.slug.replace(/[^A-Za-z0-9_-]/g, '-') }],
      })
      const accepted = await acceptEmail(ctx, request)
      return { to: address, id: accepted.id }
    }),
  )

  return json({
    object: 'template_test',
    template_id: template.id,
    version: version.version,
    sent,
    warnings: rendered.warnings,
  })
})

async function load(
  ctx: Ctx,
  id: string,
): Promise<{ template: TemplateRow; version: VersionRow | null }> {
  const template = await ctx.sql
    .prepare(
      `SELECT id, name, slug, engine, current_version, created_at, updated_at
         FROM templates WHERE id = ? AND workspace_id = ?`,
    )
    .bind(id, ctx.workspace.id)
    .first<TemplateRow>()
  if (!template) throw apiError('not_found')
  const version = await ctx.sql
    .prepare(
      `SELECT id, template_id, version, subject, html, text, ast, variables, created_at
         FROM template_versions WHERE workspace_id = ? AND template_id = ? AND version = ?`,
    )
    .bind(ctx.workspace.id, id, template.current_version)
    .first<VersionRow>()
  return { template, version }
}

async function versionRow(ctx: Ctx, templateId: string, version: number): Promise<VersionRow> {
  const row = await ctx.sql
    .prepare(
      `SELECT id, template_id, version, subject, html, text, ast, variables, created_at
         FROM template_versions WHERE workspace_id = ? AND template_id = ? AND version = ?`,
    )
    .bind(ctx.workspace.id, templateId, version)
    .first<VersionRow>()
  if (!row) throw apiError('not_found', { message: `Version ${version} does not exist.` })
  return row
}

const nextVersion = async (ctx: Ctx, templateId: string): Promise<number> => {
  const row = await ctx.sql
    .prepare(
      'SELECT MAX(version) AS max FROM template_versions WHERE workspace_id = ? AND template_id = ?',
    )
    .bind(ctx.workspace.id, templateId)
    .first<{ max: number | null }>()
  return (row?.max ?? 0) + 1
}

async function publish(ctx: Ctx, template: TemplateRow, version: VersionRow) {
  const now = new Date().toISOString()
  // `templates.current_version` *is* the published pointer — there is no
  // separate published_version column in the schema, and adding one would give
  // the same fact two homes that can disagree.
  await ctx.sql
    .prepare(
      'UPDATE templates SET current_version = ?, updated_at = ? WHERE id = ? AND workspace_id = ?',
    )
    .bind(version.version, now, template.id, ctx.workspace.id)
    .run()
  return {
    object: 'template' as const,
    id: template.id,
    published_version: version.version,
    version: version.version,
    published_at: now,
  }
}

export { templates }
