import type { Sql, SqlStatement } from '@mailysend/platform'
import type { CompiledSegment } from './compile.ts'
import { compile, relativeWindows } from './compile.ts'
import { COLUMNS } from './fields.ts'
import { parse } from './parser.ts'

/**
 * Evaluating segments against the contacts table.
 *
 * Everything here obeys two limits that are easy to forget until production
 * finds them for you:
 *
 *   - D1 allows at most 100 bound parameters in one statement. A segment
 *     expression contributes some of them, so every id list is chunked against
 *     the budget that is *left*, not against a constant.
 *   - There is no statement timeout worth relying on, so no query is allowed to
 *     scale with the size of the audience. Full recomputation is a keyset walk
 *     over `contacts_ws_id`, one bounded page at a time, resumable after a
 *     crash because each page's writes are committed before the next is read.
 */

const D1_MAX_BOUND_PARAMS = 100
/** workspace_id, segment_id, contact_id, created_at. */
const MEMBER_COLUMNS = 4
/** Statements per `batch`. Big enough to matter, small enough to stay a unit. */
const BATCH_STATEMENTS = 20

export interface SegmentSpec {
  id: string
  audienceId: string
  expression: string
}

export interface RunOptions {
  /** Resolves relative windows. Pin it to make a recompute reproducible. */
  now?: Date
  /** Contacts per keyset page. 500 is a comfortable page on both runtimes. */
  pageSize?: number
}

export interface RecomputeResult {
  added: number
  removed: number
  /** Contacts examined. For a delta pass this is the number of ids handed in. */
  scanned: number
  matched: number
}

const compileFor = (segment: SegmentSpec, options: RunOptions): CompiledSegment =>
  compile(parse(segment.expression), { now: options.now })

const nowIso = (options: RunOptions): string => (options.now ?? new Date()).toISOString()

export const countSegment = async (
  sql: Sql,
  workspaceId: string,
  segment: SegmentSpec,
  options: RunOptions = {},
): Promise<number> => {
  const { sql: frag, params } = compileFor(segment, options)
  const row = await sql
    .prepare(
      `SELECT COUNT(*) AS n FROM contacts WHERE workspace_id = ? AND audience_id = ? AND ${frag}`,
    )
    .bind(workspaceId, segment.audienceId, ...params)
    .first<{ n: number }>()
  return Number(row?.n ?? 0)
}

interface PageRow {
  id: string
  matched: number
}

/**
 * Reads one keyset page of contacts together with whether each one matches.
 *
 * The predicate goes in the SELECT list as well as being the thing we care
 * about, so a single query returns both the page and the verdict. Note the
 * parameter order: SQLite binds `?` in textual order, and the projected
 * predicate is textually ahead of the WHERE clause.
 */
const readPage = async (
  sql: Sql,
  workspaceId: string,
  audienceId: string,
  compiled: CompiledSegment,
  after: string,
  limit: number,
): Promise<PageRow[]> => {
  const { results } = await sql
    .prepare(
      `SELECT id, CASE WHEN ${compiled.sql} THEN 1 ELSE 0 END AS matched
       FROM contacts
       WHERE workspace_id = ? AND audience_id = ? AND id > ?
       ORDER BY id
       LIMIT ?`,
    )
    .bind(...compiled.params, workspaceId, audienceId, after, limit)
    .all<PageRow>()
  return results
}

const insertStatements = (
  sql: Sql,
  workspaceId: string,
  segmentId: string,
  contactIds: string[],
  at: string,
): SqlStatement[] => {
  const perStatement = Math.floor(D1_MAX_BOUND_PARAMS / MEMBER_COLUMNS)
  const out: SqlStatement[] = []
  for (let i = 0; i < contactIds.length; i += perStatement) {
    const chunk = contactIds.slice(i, i + perStatement)
    // OR IGNORE, not REPLACE: `created_at` is when the contact *entered* the
    // segment, which automations trigger on. A recompute that reconfirms an
    // existing member must not reset it.
    out.push(
      sql
        .prepare(
          `INSERT OR IGNORE INTO segment_members (workspace_id, segment_id, contact_id, created_at)
           VALUES ${chunk.map(() => '(?, ?, ?, ?)').join(', ')}`,
        )
        .bind(...chunk.flatMap((id) => [workspaceId, segmentId, id, at])),
    )
  }
  return out
}

const deleteStatements = (
  sql: Sql,
  workspaceId: string,
  segmentId: string,
  contactIds: string[],
): SqlStatement[] => {
  const perStatement = D1_MAX_BOUND_PARAMS - 2
  const out: SqlStatement[] = []
  for (let i = 0; i < contactIds.length; i += perStatement) {
    const chunk = contactIds.slice(i, i + perStatement)
    out.push(
      sql
        .prepare(
          `DELETE FROM segment_members
           WHERE workspace_id = ? AND segment_id = ? AND contact_id IN (${chunk.map(() => '?').join(', ')})`,
        )
        .bind(workspaceId, segmentId, ...chunk),
    )
  }
  return out
}

/**
 * Writes the membership changes.
 *
 * `add` and `remove` are already diffed against what is stored, so the counts
 * returned are exact without reading `meta.changes` back — which D1 reports for
 * a batch but `node:sqlite` does not, and a membership count that is right on
 * one runtime and zero on the other is worse than no count at all.
 */
const applyChanges = async (
  sql: Sql,
  workspaceId: string,
  segmentId: string,
  add: string[],
  remove: string[],
  at: string,
): Promise<void> => {
  const statements = [
    ...insertStatements(sql, workspaceId, segmentId, add, at),
    ...deleteStatements(sql, workspaceId, segmentId, remove),
  ]
  for (let i = 0; i < statements.length; i += BATCH_STATEMENTS) {
    await sql.batch(statements.slice(i, i + BATCH_STATEMENTS))
  }
}

/** Current members among a contiguous, keyset-bounded id range. */
const membersInRange = async (
  sql: Sql,
  workspaceId: string,
  segmentId: string,
  after: string,
  through: string,
): Promise<Set<string>> => {
  const { results } = await sql
    .prepare(
      `SELECT contact_id FROM segment_members
       WHERE workspace_id = ? AND segment_id = ? AND contact_id > ? AND contact_id <= ?`,
    )
    .bind(workspaceId, segmentId, after, through)
    .all<{ contact_id: string }>()
  return new Set(results.map((r) => r.contact_id))
}

/**
 * Rebuilds a segment's membership from scratch.
 *
 * It walks every contact in the audience once, in id order, and reconciles each
 * page as it goes rather than deleting the segment up front and refilling it.
 * The difference matters: a broadcast that reads `segment_members` mid-recompute
 * sees a slightly stale segment instead of an empty one.
 *
 * A member row whose contact has since been deleted cannot be found by that
 * walk, so a second — equally paginated — pass sweeps those up at the end.
 */
export const recomputeFull = async (
  sql: Sql,
  workspaceId: string,
  segment: SegmentSpec,
  options: RunOptions = {},
): Promise<RecomputeResult> => {
  const compiled = compileFor(segment, options)
  const pageSize = options.pageSize ?? 500
  const at = nowIso(options)

  let cursor = ''
  let added = 0
  let removed = 0
  let scanned = 0
  let matched = 0

  for (;;) {
    const page = await readPage(sql, workspaceId, segment.audienceId, compiled, cursor, pageSize)
    if (page.length === 0) break

    const last = page.at(-1)!.id
    const existing = await membersInRange(sql, workspaceId, segment.id, cursor, last)
    const hits = page.filter((r) => r.matched === 1).map((r) => r.id)
    const add = hits.filter((id) => !existing.has(id))
    const drop = page.filter((r) => r.matched !== 1 && existing.has(r.id)).map((r) => r.id)
    await applyChanges(sql, workspaceId, segment.id, add, drop, at)

    added += add.length
    removed += drop.length
    scanned += page.length
    matched += hits.length
    cursor = last
    if (page.length < pageSize) break
  }

  removed += await sweepOrphans(sql, workspaceId, segment, pageSize)
  return { added, removed, scanned, matched }
}

/** Member rows whose contact no longer exists in the audience. */
const sweepOrphans = async (
  sql: Sql,
  workspaceId: string,
  segment: SegmentSpec,
  pageSize: number,
): Promise<number> => {
  const perPage = Math.min(pageSize, D1_MAX_BOUND_PARAMS - 2)
  let cursor = ''
  let removed = 0

  for (;;) {
    const { results } = await sql
      .prepare(
        `SELECT contact_id FROM segment_members
         WHERE workspace_id = ? AND segment_id = ? AND contact_id > ?
         ORDER BY contact_id
         LIMIT ?`,
      )
      .bind(workspaceId, segment.id, cursor, perPage)
      .all<{ contact_id: string }>()
    if (results.length === 0) break

    const ids = results.map((r) => r.contact_id)
    const { results: alive } = await sql
      .prepare(
        `SELECT id FROM contacts
         WHERE workspace_id = ? AND audience_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
      )
      .bind(workspaceId, segment.audienceId, ...ids)
      .all<{ id: string }>()

    const living = new Set(alive.map((r) => r.id))
    const orphans = ids.filter((id) => !living.has(id))
    if (orphans.length > 0) {
      await sql.batch(deleteStatements(sql, workspaceId, segment.id, orphans))
      removed += orphans.length
    }

    cursor = ids.at(-1)!
    if (results.length < perPage) break
  }
  return removed
}

/**
 * Re-evaluates a named set of contacts and nothing else.
 *
 * This is the hot path: the event consumer marks contacts dirty, and only the
 * segments whose `dependsOn` intersects the changed fields get here. Ids that
 * come back from the lookup as non-matching *and* ids that do not come back at
 * all (the contact was deleted or moved audience) both mean "remove", which is
 * why the removal set is derived from the input rather than from the query.
 */
export const recomputeDelta = async (
  sql: Sql,
  workspaceId: string,
  segment: SegmentSpec,
  contactIds: string[],
  options: RunOptions = {},
): Promise<RecomputeResult> => {
  const ids = [...new Set(contactIds)]
  if (ids.length === 0) return { added: 0, removed: 0, scanned: 0, matched: 0 }

  const compiled = compileFor(segment, options)
  const at = nowIso(options)
  // Two fixed parameters plus whatever the expression itself binds.
  const perChunk = Math.max(1, D1_MAX_BOUND_PARAMS - 2 - compiled.params.length)

  let added = 0
  let removed = 0
  let matched = 0

  for (let i = 0; i < ids.length; i += perChunk) {
    const chunk = ids.slice(i, i + perChunk)
    const { results } = await sql
      .prepare(
        `SELECT id, CASE WHEN ${compiled.sql} THEN 1 ELSE 0 END AS matched
         FROM contacts
         WHERE workspace_id = ? AND audience_id = ? AND id IN (${chunk.map(() => '?').join(', ')})`,
      )
      .bind(...compiled.params, workspaceId, segment.audienceId, ...chunk)
      .all<PageRow>()

    const { results: members } = await sql
      .prepare(
        `SELECT contact_id FROM segment_members
         WHERE workspace_id = ? AND segment_id = ? AND contact_id IN (${chunk.map(() => '?').join(', ')})`,
      )
      .bind(workspaceId, segment.id, ...chunk)
      .all<{ contact_id: string }>()
    const existing = new Set(members.map((r) => r.contact_id))

    const hits = results.filter((r) => r.matched === 1).map((r) => r.id)
    const keep = new Set(hits)
    const add = hits.filter((id) => !existing.has(id))
    const drop = chunk.filter((id) => !keep.has(id) && existing.has(id))
    await applyChanges(sql, workspaceId, segment.id, add, drop, at)

    added += add.length
    removed += drop.length
    matched += hits.length
  }

  return { added, removed, scanned: ids.length, matched }
}

export interface BoundarySweepResult extends RecomputeResult {
  /** Contacts the sweep decided were worth re-checking. */
  candidates: number
  /** False when the segment has no time-relative predicate, so nothing can drift. */
  applicable: boolean
}

/**
 * Re-evaluates the contacts whose membership changed because time passed.
 *
 * This is the case nothing else catches. `last_open_at > now - 30d` is a moving
 * threshold: a contact who last opened at 09:15 on the 1st silently stops
 * matching at 09:15 on the 31st, with no write to their row, so they are never
 * marked dirty and a delta pass never looks at them.
 *
 * The mechanism is to invert the predicate. Over the hour `[hourStart, hourEnd)`
 * the threshold `now - d` sweeps the interval `[hourStart - d, hourEnd - d)`.
 * A contact's membership can only flip during that hour if their timestamp lies
 * inside that interval — one timestamp, one window, one indexed range scan
 * (`contacts_engagement` is keyed on `last_open_at`). Everyone else provably
 * cannot have changed, so the sweep touches a few rows an hour instead of the
 * whole audience.
 *
 * Contacts with a NULL timestamp are correctly excluded: NULL fails the
 * comparison at every threshold, so no amount of elapsed time flips them.
 */
export const boundarySweep = async (
  sql: Sql,
  workspaceId: string,
  segment: SegmentSpec,
  hourStart: Date,
  hourEnd: Date,
  options: RunOptions = {},
): Promise<BoundarySweepResult> => {
  const windows = relativeWindows(parse(segment.expression))
  const empty = { added: 0, removed: 0, scanned: 0, matched: 0, candidates: 0 }
  if (windows.length === 0) return { ...empty, applicable: false }

  const candidates = new Set<string>()
  for (const window of windows) {
    const from = new Date(hourStart.getTime() - window.ms).toISOString()
    const to = new Date(hourEnd.getTime() - window.ms).toISOString()
    const { results } = await sql
      .prepare(
        `SELECT id FROM contacts
         WHERE workspace_id = ? AND audience_id = ? AND ${COLUMNS[window.column].sql} >= ? AND ${COLUMNS[window.column].sql} < ?`,
      )
      .bind(workspaceId, segment.audienceId, from, to)
      .all<{ id: string }>()
    for (const r of results) candidates.add(r.id)
  }

  if (candidates.size === 0) return { ...empty, applicable: true }

  // Evaluate as of the end of the hour: that is the clock the sweep is catching
  // the segment up to.
  const result = await recomputeDelta(sql, workspaceId, segment, [...candidates], {
    ...options,
    now: hourEnd,
  })
  return { ...result, candidates: candidates.size, applicable: true }
}

export interface PreviewContact {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  created_at: string
}

export interface PreviewResult {
  contacts: PreviewContact[]
  /** Total matches, not just the page. The builder shows "1 of 12,431". */
  total: number
  dependsOn: string[]
  /** Echoed so the builder can show the generated SQL. Parameters stay separate. */
  sql: string
}

/**
 * Runs an unsaved expression for the segment builder.
 *
 * Takes the source rather than a `SegmentSpec` because the expression being
 * previewed does not exist yet — and because a parse error here is a 422 the
 * user is meant to see, not a background job failure.
 */
export const previewSegment = async (
  sql: Sql,
  workspaceId: string,
  expression: string,
  audienceId: string,
  limit = 25,
  options: RunOptions = {},
): Promise<PreviewResult> => {
  const compiled = compile(parse(expression), { now: options.now })
  const scoped = `WHERE workspace_id = ? AND audience_id = ? AND ${compiled.sql}`

  const { results } = await sql
    .prepare(
      `SELECT id, email, first_name, last_name, created_at FROM contacts ${scoped} ORDER BY id LIMIT ?`,
    )
    .bind(workspaceId, audienceId, ...compiled.params, Math.min(Math.max(limit, 1), 100))
    .all<PreviewContact>()

  const total = await sql
    .prepare(`SELECT COUNT(*) AS n FROM contacts ${scoped}`)
    .bind(workspaceId, audienceId, ...compiled.params)
    .first<{ n: number }>()

  return {
    contacts: results,
    total: Number(total?.n ?? 0),
    dependsOn: compiled.dependsOn,
    sql: compiled.sql,
  }
}
