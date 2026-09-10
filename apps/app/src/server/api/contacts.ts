import { apiError, CreateContactRequest, UpdateContactRequest } from '@mailysend/contracts'
import { kvKey, newId, normalizeForSuppression } from '@mailysend/core'
import type { SqlStatement } from '@mailysend/platform'
import type { Context } from 'hono'
import { requireRole, requireScope } from '../auth.ts'
import type { Ctx } from '../context.ts'
import { type App, createRouter, json, page, parseLimit, type Vars, withContext } from './base.ts'

/**
 * `/v1/contacts` — the rows every segment, broadcast and automation resolves to.
 *
 * Two things are true of every write in this file and of no write anywhere
 * else. First, it marks the contact dirty: segment membership is maintained by
 * delta, and a write that does not announce itself makes a live segment quietly
 * wrong until the next full recompute. Second, an unsubscribe writes a
 * suppression as well as the flag, because unsubscribing is a statement about a
 * person, not about a row — the same address sitting in a second audience must
 * not receive the next broadcast either.
 */

type Handler = (c: Context<{ Variables: Vars }>) => Promise<Response>

const contacts: App = createRouter()

contacts.use('*', withContext())

/** Fields a contact write can change that a segment expression can read. */
const DIRTY_FIELDS = ['email', 'first_name', 'last_name', 'unsubscribed', 'data']

/**
 * The compiler reports a custom field as `data.<key>`, so a write that touched
 * one has to say so in the same vocabulary or the intersection the consumer
 * takes against `segments.depends_on` will silently miss it.
 */
const dirtyFieldsFor = (data: Record<string, unknown> | undefined): string[] => [
  ...DIRTY_FIELDS,
  ...Object.keys(data ?? {}).map((key) => `data.${key}`),
]

const MAX_IMPORT_ROWS = 10_000
/** One statement per row against D1's 100-parameter ceiling; 20 per batch. */
const IMPORT_BATCH = 20

interface ContactRow {
  id: string
  audience_id: string
  email: string
  first_name: string | null
  last_name: string | null
  unsubscribed: number
  unsubscribed_at: string | null
  data: string | null
  last_open_at: string | null
  last_click_at: string | null
  open_count: number
  click_count: number
  created_at: string
  updated_at: string
}

const toContact = (row: ContactRow) => ({
  object: 'contact' as const,
  id: row.id,
  audience_id: row.audience_id,
  email: row.email,
  first_name: row.first_name,
  last_name: row.last_name,
  unsubscribed: row.unsubscribed === 1,
  unsubscribed_at: row.unsubscribed_at,
  data: row.data ? (JSON.parse(row.data) as Record<string, unknown>) : null,
  last_open_at: row.last_open_at,
  last_click_at: row.last_click_at,
  open_count: row.open_count,
  click_count: row.click_count,
  created_at: row.created_at,
})

const CONTACT_COLUMNS = `id, audience_id, email, first_name, last_name, unsubscribed, unsubscribed_at,
       data, last_open_at, last_click_at, open_count, click_count, created_at, updated_at`

/**
 * `contact_dirty` is a set, not a log: the same contact edited twice before the
 * consumer runs must report the union of what changed, or the second write's
 * fields would be lost and a segment reading them would never be re-evaluated.
 */
const dirtyStatement = (ctx: Ctx, contactId: string, fields: string[], at: string): SqlStatement =>
  ctx.sql
    .prepare(
      `INSERT INTO contact_dirty (workspace_id, contact_id, fields, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (workspace_id, contact_id) DO UPDATE SET fields =
           (SELECT json_group_array(DISTINCT value) FROM (
              SELECT value FROM json_each(contact_dirty.fields)
              UNION ALL SELECT value FROM json_each(excluded.fields)))`,
    )
    .bind(ctx.workspace.id, contactId, JSON.stringify(fields), at)

const suppressionStatement = (ctx: Ctx, email: string, at: string): SqlStatement =>
  ctx.sql
    .prepare(
      `INSERT INTO suppressions (workspace_id, email, original_email, reason, source, expires_at, created_at)
         VALUES (?, ?, ?, 'unsubscribe', 'contact', NULL, ?)
         ON CONFLICT (workspace_id, email) DO NOTHING`,
    )
    .bind(ctx.workspace.id, normalizeForSuppression(email), email, at)

/** The send path reads suppressions from KV, so the row alone would not stop a send. */
const suppressInKv = (ctx: Ctx, email: string): Promise<void> =>
  ctx.suppressions.put(
    kvKey.suppression(ctx.workspace.id, normalizeForSuppression(email)),
    JSON.stringify({ reason: 'unsubscribe', at: new Date().toISOString() }),
  )

const fieldType = (value: unknown): string =>
  typeof value === 'number'
    ? 'number'
    : typeof value === 'boolean'
      ? 'boolean'
      : typeof value === 'string'
        ? 'string'
        : 'json'

/**
 * Custom keys are registered as they are used. The counter is what lets the
 * segment builder offer the keys people actually have, and what decides which
 * `json_extract` paths are worth an expression index.
 */
const fieldStatements = (
  ctx: Ctx,
  audienceId: string,
  data: Record<string, unknown> | undefined,
): SqlStatement[] =>
  Object.entries(data ?? {}).map(([key, value]) =>
    ctx.sql
      .prepare(
        `INSERT INTO contact_fields (workspace_id, audience_id, key, type, usage_count, indexed)
           VALUES (?, ?, ?, ?, 1, 0)
           ON CONFLICT (workspace_id, audience_id, key)
           DO UPDATE SET usage_count = usage_count + 1, type = excluded.type`,
      )
      .bind(ctx.workspace.id, audienceId, key, fieldType(value)),
  )

async function requireAudience(ctx: Ctx, audienceId: string): Promise<string> {
  const row = await ctx.sql
    .prepare('SELECT id FROM audiences WHERE id = ? AND workspace_id = ?')
    .bind(audienceId, ctx.workspace.id)
    .first<{ id: string }>()
  if (!row)
    throw apiError('not_found', { message: `No audience \`${audienceId}\` in this workspace.` })
  return row.id
}

const audienceParam = (c: Context<{ Variables: Vars }>, fromBody?: string): string => {
  const id = c.req.param('audience_id') ?? fromBody ?? c.req.query('audience_id')
  if (!id) throw apiError('missing_required_field', { param: 'audience_id' })
  return id
}

const recountStatement = (ctx: Ctx, audienceId: string): SqlStatement =>
  ctx.sql
    .prepare(
      `UPDATE audiences SET contact_count =
         (SELECT COUNT(*) FROM contacts WHERE workspace_id = ?1 AND audience_id = ?2)
       WHERE id = ?2 AND workspace_id = ?1`,
    )
    .bind(ctx.workspace.id, audienceId)

/**
 * Create, or update in place.
 *
 * Resend's create is an upsert against `(audience_id, email)` and callers rely
 * on it — a signup form that POSTs twice must not 409 at the second visitor.
 */
const create: Handler = async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'contacts:write')
  requireRole(ctx.actor, 'marketer')
  const body = CreateContactRequest.parse(await c.req.json())
  const audienceId = await requireAudience(ctx, audienceParam(c, body.audience_id))

  const email = body.email.toLowerCase()
  const now = new Date().toISOString()
  const unsubscribed = body.unsubscribed === true

  const existing = await ctx.sql
    .prepare('SELECT id FROM contacts WHERE workspace_id = ? AND audience_id = ? AND email = ?')
    .bind(ctx.workspace.id, audienceId, email)
    .first<{ id: string }>()

  const id = existing?.id ?? newId('contact')
  const statements: SqlStatement[] = []

  if (existing) {
    statements.push(
      ctx.sql
        .prepare(
          `UPDATE contacts SET first_name = ?, last_name = ?, unsubscribed = ?, unsubscribed_at = ?,
                  data = COALESCE(?, data), updated_at = ?
             WHERE id = ? AND workspace_id = ?`,
        )
        .bind(
          body.first_name ?? null,
          body.last_name ?? null,
          unsubscribed ? 1 : 0,
          unsubscribed ? now : null,
          body.data ? JSON.stringify(body.data) : null,
          now,
          id,
          ctx.workspace.id,
        ),
    )
  } else {
    statements.push(
      ctx.sql
        .prepare(
          `INSERT INTO contacts (id, workspace_id, audience_id, email, first_name, last_name,
                                 unsubscribed, unsubscribed_at, data, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          ctx.workspace.id,
          audienceId,
          email,
          body.first_name ?? null,
          body.last_name ?? null,
          unsubscribed ? 1 : 0,
          unsubscribed ? now : null,
          body.data ? JSON.stringify(body.data) : null,
          now,
          now,
        ),
      recountStatement(ctx, audienceId),
    )
  }

  statements.push(
    dirtyStatement(ctx, id, dirtyFieldsFor(body.data), now),
    ...fieldStatements(ctx, audienceId, body.data),
  )
  if (unsubscribed) statements.push(suppressionStatement(ctx, email, now))
  await ctx.sql.batch(statements)
  if (unsubscribed) ctx.background(suppressInKv(ctx, email))

  return json(
    {
      object: 'contact',
      id,
      audience_id: audienceId,
      email,
      first_name: body.first_name ?? null,
      last_name: body.last_name ?? null,
      unsubscribed,
      created_at: now,
    },
    existing ? 200 : 201,
  )
}

const list: Handler = async (c) => {
  const ctx = c.get('ctx')
  const limit = parseLimit(c.req.query('limit'))
  const cursor = c.req.query('cursor')
  const audienceId = c.req.param('audience_id') ?? c.req.query('audience_id')
  const subscription = c.req.query('unsubscribed')
  const search = c.req.query('search')?.trim()

  const filters: string[] = []
  const params: unknown[] = [ctx.workspace.id]
  if (audienceId) {
    filters.push('AND audience_id = ?')
    params.push(audienceId)
  }
  if (cursor) {
    filters.push('AND id < ?')
    params.push(cursor)
  }
  if (subscription === 'true' || subscription === 'false') {
    filters.push('AND unsubscribed = ?')
    params.push(subscription === 'true' ? 1 : 0)
  }
  if (search) {
    filters.push('AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ?)')
    const like = `%${search}%`
    params.push(like, like, like)
  }

  const rows = await ctx.sql
    .prepare(
      `SELECT ${CONTACT_COLUMNS} FROM contacts
        WHERE workspace_id = ? ${filters.join(' ')}
        ORDER BY id DESC LIMIT ?`,
    )
    .bind(...params, limit + 1)
    .all<ContactRow>()

  return json(page(rows.results.map(toContact), limit))
}

/** Resend addresses a contact by id *or* by email, so both resolve here. */
const get: Handler = async (c) => {
  const ctx = c.get('ctx')
  const row = await findContact(ctx, c.req.param('id') ?? '', c.req.param('audience_id'))
  if (!row) throw apiError('not_found')
  return json(toContact(row))
}

async function findContact(ctx: Ctx, key: string, audienceId?: string): Promise<ContactRow | null> {
  const byEmail = key.includes('@')
  return ctx.sql
    .prepare(
      `SELECT ${CONTACT_COLUMNS} FROM contacts
        WHERE workspace_id = ? AND ${byEmail ? 'email = ?' : 'id = ?'}
          ${audienceId ? 'AND audience_id = ?' : ''}
        ORDER BY id DESC LIMIT 1`,
    )
    .bind(ctx.workspace.id, byEmail ? key.toLowerCase() : key, ...(audienceId ? [audienceId] : []))
    .first<ContactRow>()
}

const update: Handler = async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'contacts:write')
  requireRole(ctx.actor, 'marketer')
  const body = UpdateContactRequest.parse(await c.req.json())
  const row = await findContact(ctx, c.req.param('id') ?? '', c.req.param('audience_id'))
  if (!row) throw apiError('not_found')

  const now = new Date().toISOString()
  const sets: string[] = ['updated_at = ?']
  const params: unknown[] = [now]
  const changed: string[] = []

  if (body.email !== undefined) {
    sets.push('email = ?')
    params.push(body.email.toLowerCase())
    changed.push('email')
  }
  if (body.first_name !== undefined) {
    sets.push('first_name = ?')
    params.push(body.first_name)
    changed.push('first_name')
  }
  if (body.last_name !== undefined) {
    sets.push('last_name = ?')
    params.push(body.last_name)
    changed.push('last_name')
  }
  if (body.data !== undefined) {
    sets.push('data = ?')
    params.push(JSON.stringify(body.data))
    changed.push('data')
  }
  // Re-subscribing clears the timestamp but deliberately leaves the suppression
  // standing: only the person, through the unsubscribe link, may undo that.
  if (body.unsubscribed !== undefined) {
    sets.push('unsubscribed = ?', 'unsubscribed_at = ?')
    params.push(body.unsubscribed ? 1 : 0, body.unsubscribed ? now : null)
    changed.push('unsubscribed')
  }

  const statements: SqlStatement[] = [
    ctx.sql
      .prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`)
      .bind(...params, row.id, ctx.workspace.id),
    dirtyStatement(
      ctx,
      row.id,
      [...changed, ...Object.keys(body.data ?? {}).map((k) => `data.${k}`)],
      now,
    ),
    ...fieldStatements(ctx, row.audience_id, body.data),
  ]
  const email = body.email?.toLowerCase() ?? row.email
  if (body.unsubscribed === true) statements.push(suppressionStatement(ctx, email, now))
  await ctx.sql.batch(statements)
  if (body.unsubscribed === true) ctx.background(suppressInKv(ctx, email))

  const fresh = await findContact(ctx, row.id)
  return json(toContact(fresh ?? row))
}

const remove: Handler = async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'contacts:write')
  requireRole(ctx.actor, 'marketer')
  const row = await findContact(ctx, c.req.param('id') ?? '', c.req.param('audience_id'))
  if (!row) throw apiError('not_found')

  await ctx.sql.batch([
    ctx.sql
      .prepare('DELETE FROM contacts WHERE id = ? AND workspace_id = ?')
      .bind(row.id, ctx.workspace.id),
    ctx.sql
      .prepare('DELETE FROM segment_members WHERE workspace_id = ? AND contact_id = ?')
      .bind(ctx.workspace.id, row.id),
    // Still marked dirty: a delta pass treats an id it cannot find as a removal,
    // which is how any segment that has not been swept yet drops the row too.
    dirtyStatement(ctx, row.id, DIRTY_FIELDS, new Date().toISOString()),
    recountStatement(ctx, row.audience_id),
  ])

  return json({ object: 'contact', id: row.id, deleted: true })
}

contacts.post('/', create)
contacts.get('/', list)

/**
 * `GET /v1/contacts/search?q=` — address lookahead for the composer.
 *
 * Contacts were only reachable per audience, which is the right shape for the
 * marketing screens and the wrong shape for a To field: a person typing a name
 * does not know or care which audience the address is filed under. This crosses
 * audiences, matches on address or either name, and returns a handful.
 *
 * `q` is bound, never interpolated, and its LIKE wildcards are escaped so a
 * typed `%` cannot widen its own pattern.
 */
contacts.get('/search', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'contacts:read')
  const q = (c.req.query('q') ?? '').trim()
  if (q.length < 2) {
    return json({ object: 'list', data: [], has_more: false, next_cursor: null })
  }
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`
  const rows = await ctx.sql
    .prepare(
      `SELECT id, audience_id, email, first_name, last_name
         FROM contacts
        WHERE workspace_id = ?
          AND unsubscribed = 0
          AND (email LIKE ? ESCAPE '\\'
               OR first_name LIKE ? ESCAPE '\\'
               OR last_name LIKE ? ESCAPE '\\')
        ORDER BY last_send_at DESC, email
        LIMIT 8`,
    )
    .bind(ctx.workspace.id, like, like, like)
    .all<{
      id: string
      audience_id: string
      email: string
      first_name: string | null
      last_name: string | null
    }>()

  return json({
    object: 'list',
    data: rows.results.map((row) => ({
      object: 'contact_suggestion' as const,
      id: row.id,
      audience_id: row.audience_id,
      email: row.email,
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || null,
    })),
    has_more: false,
    next_cursor: null,
  })
})

/**
 * `POST /v1/contacts/import` — CSV or JSON, up to 10,000 rows.
 *
 * A rejected import is useless feedback: the caller has a spreadsheet, not a
 * request body, and "row 3,481 is not an email address" is the only thing they
 * can act on. So every row is validated on its own and the response carries the
 * failures with their row numbers while the good rows land.
 */
contacts.post('/import', async (c) => {
  const ctx = c.get('ctx')
  requireScope(ctx.actor, 'contacts:write')
  requireRole(ctx.actor, 'marketer')

  const raw = await c.req.text()
  const contentType = c.req.header('content-type') ?? ''
  const isJson =
    contentType.includes('json') ||
    raw.trimStart().startsWith('[') ||
    raw.trimStart().startsWith('{')

  let rows: Record<string, unknown>[]
  let bodyAudience: string | undefined
  if (isJson) {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      rows = parsed as Record<string, unknown>[]
    } else {
      const envelope = parsed as { audience_id?: string; contacts?: Record<string, unknown>[] }
      bodyAudience = envelope.audience_id
      rows = envelope.contacts ?? []
    }
  } else {
    rows = parseCsv(raw)
  }

  if (rows.length === 0)
    throw apiError('validation_error', { message: 'The import contained no rows.' })
  if (rows.length > MAX_IMPORT_ROWS) {
    throw apiError('validation_error', {
      message: `An import may contain at most ${MAX_IMPORT_ROWS} rows; this one has ${rows.length}. Split it.`,
    })
  }
  const audienceId = await requireAudience(ctx, audienceParam(c, bodyAudience))

  const now = new Date().toISOString()
  const errors: { row: number; message: string }[] = []
  const statements: SqlStatement[] = []
  const unsubscribes: string[] = []
  const keys = new Set<string>()
  let accepted = 0

  rows.forEach((row, index) => {
    const parsed = CreateContactRequest.safeParse(normalizeImportRow(row))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      // +2, not +1: a CSV's first data row is line two of the file, and the
      // number in the message has to match what the user sees in their editor.
      errors.push({
        row: index + 2,
        message: `${issue?.path.join('.') ?? 'row'}: ${issue?.message ?? 'invalid'}`,
      })
      return
    }
    const contact = parsed.data
    const email = contact.email.toLowerCase()
    const unsubscribed = contact.unsubscribed === true
    if (unsubscribed) unsubscribes.push(email)
    for (const key of Object.keys(contact.data ?? {})) keys.add(key)
    accepted++

    statements.push(
      ctx.sql
        .prepare(
          `INSERT INTO contacts (id, workspace_id, audience_id, email, first_name, last_name,
                                 unsubscribed, unsubscribed_at, data, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (workspace_id, audience_id, email) DO UPDATE SET
               first_name = COALESCE(excluded.first_name, contacts.first_name),
               last_name = COALESCE(excluded.last_name, contacts.last_name),
               unsubscribed = excluded.unsubscribed,
               unsubscribed_at = COALESCE(excluded.unsubscribed_at, contacts.unsubscribed_at),
               data = COALESCE(excluded.data, contacts.data),
               updated_at = excluded.updated_at`,
        )
        .bind(
          newId('contact'),
          ctx.workspace.id,
          audienceId,
          email,
          contact.first_name ?? null,
          contact.last_name ?? null,
          unsubscribed ? 1 : 0,
          unsubscribed ? now : null,
          contact.data ? JSON.stringify(contact.data) : null,
          now,
          now,
        ),
      // The id above is discarded on conflict, so the dirty marker is written
      // from the stored row rather than from the id we just minted.
      ctx.sql
        .prepare(
          `INSERT INTO contact_dirty (workspace_id, contact_id, fields, created_at)
             SELECT ?, id, ?, ? FROM contacts WHERE workspace_id = ? AND audience_id = ? AND email = ?
             ON CONFLICT (workspace_id, contact_id) DO UPDATE SET created_at = excluded.created_at`,
        )
        .bind(
          ctx.workspace.id,
          JSON.stringify(dirtyFieldsFor(contact.data)),
          now,
          ctx.workspace.id,
          audienceId,
          email,
        ),
    )
    if (unsubscribed) statements.push(suppressionStatement(ctx, email, now))
  })

  for (let i = 0; i < statements.length; i += IMPORT_BATCH) {
    await ctx.sql.batch(statements.slice(i, i + IMPORT_BATCH))
  }
  await ctx.sql.batch([
    recountStatement(ctx, audienceId),
    ...fieldStatements(ctx, audienceId, Object.fromEntries([...keys].map((k) => [k, '']))),
  ])
  ctx.background(Promise.all(unsubscribes.map((email) => suppressInKv(ctx, email))))

  return json({
    object: 'import',
    audience_id: audienceId,
    imported: accepted,
    failed: errors.length,
    errors,
  })
})

contacts.get('/:id', get)
contacts.patch('/:id', update)
contacts.delete('/:id', remove)

/** CSV headers are matched case- and space-insensitively; anything unrecognised becomes merge data. */
const KNOWN_COLUMNS = new Set(['email', 'first_name', 'last_name', 'unsubscribed'])

function normalizeImportRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const data: Record<string, unknown> = { ...((row.data as Record<string, unknown>) ?? {}) }
  for (const [rawKey, value] of Object.entries(row)) {
    const key = rawKey
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
    if (key === 'data') continue
    if (!KNOWN_COLUMNS.has(key)) {
      if (value !== '' && value !== undefined) data[rawKey.trim()] = value
      continue
    }
    if (key === 'unsubscribed') {
      out.unsubscribed =
        value === true || value === 1 || /^(true|1|yes|y)$/i.test(String(value ?? ''))
      continue
    }
    if (value === '' || value === null || value === undefined) continue
    out[key] = value
  }
  if (Object.keys(data).length > 0) out.data = data
  return out
}

/**
 * A CSV reader rather than a dependency: the format an export produces is
 * RFC 4180 and the only subtlety is that a quoted field may contain commas,
 * newlines and doubled quotes.
 */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some((v) => v !== '')) rows.push(row)

  const header = rows.shift()
  if (!header) return []
  return rows.map((values) =>
    Object.fromEntries(header.map((name, index) => [name.trim(), (values[index] ?? '').trim()])),
  )
}

export { contacts }
export const contactHandlers = { create, list, get, update, remove }
