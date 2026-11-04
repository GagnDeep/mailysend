import type { Sql, SqlStatement } from '@mailysend/platform'
import { MIGRATION_FILES } from './migrations.generated.ts'

/**
 * Migrations.
 *
 * Wrangler applies these to D1 through `wrangler d1 migrations apply`, but the
 * Node runtime has no such tool and the one-click deploy has no shell — so the
 * same SQL is embedded and applied by the app at boot. One migration set, three
 * ways of running it, no divergence.
 */

export interface Migration {
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = MIGRATION_FILES

export interface MigrateResult {
  applied: string[]
  skipped: string[]
}

export async function migrate(
  sql: Sql,
  migrations: Migration[] = MIGRATIONS,
): Promise<MigrateResult> {
  // `prepare().run()`, not `exec()`, and on one line. D1's `exec` splits its
  // input on newlines and demands a complete statement per line, so the pretty
  // multi-line form here failed with `incomplete input` against D1 while
  // working perfectly against node:sqlite — the bootstrap migration ran on
  // Node and threw on every single Cloudflare request.
  await sql
    .prepare(
      'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
    )
    .run()

  const { results } = await sql.prepare('SELECT name FROM _migrations').all<{ name: string }>()
  const done = new Set(results.map((r) => r.name))

  // `wrangler d1 migrations apply` records what it ran in its own table,
  // `d1_migrations`, under the same file names. A database migrated that way
  // (by hand, by a CI step, or by an installer such as Appflare) already has
  // those tables, and running 0000_init.sql again would fail on the first
  // CREATE TABLE. So a migration wrangler applied counts as applied here too,
  // and is recorded in `_migrations` so later boots need not look again.
  const adopted = (await wranglerApplied(sql)).filter(
    (name) => !done.has(name) && migrations.some((m) => m.name === name),
  )
  if (adopted.length > 0) {
    await sql.batch(adopted.map((name) => record(sql, name)))
    for (const name of adopted) done.add(name)
  }

  // Nothing recorded, but objects already in the schema: a previous run died
  // part-way. Recoverable, and only here. See `resetHalfAppliedSchema`.
  if (done.size === 0) await resetHalfAppliedSchema(sql)

  const applied: string[] = []
  const skipped: string[] = []

  for (const m of migrations) {
    if (done.has(m.name)) {
      skipped.push(m.name)
      continue
    }
    const statements = splitStatements(m.sql)
    const ours = statements.some(isPragma)
      ? await applyStepwise(sql, m, statements)
      : await applyAtomically(sql, m, statements)
    // `false` means another runner committed this migration while we were
    // applying it. See `lostTheRace`.
    if (ours) applied.push(m.name)
    else skipped.push(m.name)
  }

  return { applied, skipped }
}

/** Names of the migrations `wrangler d1 migrations apply` recorded, if it ever ran here. */
async function wranglerApplied(sql: Sql): Promise<string[]> {
  const table = await sql
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'")
    .all<{ name: string }>()
  if (table.results.length === 0) return []
  const { results } = await sql.prepare('SELECT name FROM d1_migrations').all<{ name: string }>()
  return results.map((r) => r.name)
}

/** The row that says a migration ran. Bound, so it can ride inside a batch. */
const record = (sql: Sql, name: string): SqlStatement =>
  sql
    .prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)')
    .bind(name, new Date().toISOString())

/**
 * One migration, one transaction, including the row that records it.
 *
 * This is the fix for a failure that bricked a deployment permanently, and the
 * reasoning is worth keeping. `0000_init.sql` is 122 statements. Applied one at
 * a time against remote D1 that is 122 round trips — ten to twenty seconds —
 * on the very first request a fresh deployment ever answers. Nobody waits that
 * long: the browser gives up, Cloudflare cancels the isolate, and the database
 * is left holding the first nineteen tables with *nothing* in `_migrations`.
 * Every request after that re-runs the migration from statement one and dies
 * on `table api_keys already exists`, so the instance answers 500 on every
 * route — including `/v1/health` — until somebody drops the tables by hand.
 *
 * `batch` closes both halves of that. It is a single SQL transaction, so a
 * migration either lands completely or not at all and a cancelled request
 * leaves no trace; and it is one round trip rather than 122, so the window
 * narrows from ~15s to well under a second. D1 counts a batch as one query
 * against the per-invocation limit however many statements it holds, and the
 * documented examples run thousands, so the 122 here is not near any ceiling.
 *
 * Recording the migration inside the same transaction is the other half: it
 * makes "the tables exist" and "the migration is recorded" the same fact,
 * which is precisely what came apart above.
 *
 * The cost is the error message. A failing batch reports the statement that
 * broke but not its position, so the per-statement `failed on:\n<sql>` detail
 * is gone for atomically-applied migrations — D1's own message names the table
 * or column at fault, which has been enough in practice, and the trade is a
 * worse diagnostic against a failure that can no longer leave a mess behind.
 */
async function applyAtomically(sql: Sql, m: Migration, statements: string[]): Promise<boolean> {
  try {
    await sql.batch([...statements.map((s) => sql.prepare(s)), record(sql, m.name)])
    return true
  } catch (err) {
    if (await lostTheRace(sql, m.name)) return false
    throw new Error(
      `migration ${m.name} failed and was rolled back (${statements.length} statements):\n\n${String(err)}`,
    )
  }
}

/**
 * Did somebody else apply this migration while we were applying it?
 *
 * Workers runs a cold deployment's first requests in several isolates at once,
 * and each one reads the list of applied migrations before any of them commits.
 * So two runners genuinely do apply the same migration concurrently: one wins,
 * the other's transaction rolls back and it surfaces whatever the collision
 * happened to look like — `duplicate column name: origin`, which is a true
 * statement about a database that is nonetheless perfectly fine.
 *
 * Re-reading `_migrations` after a failure is what tells those two cases
 * apart, and it is only meaningful *because* the apply is atomic: the loser's
 * work was rolled back whole, so a recorded migration means the winner's work
 * is all there. A real failure finds no row and still throws.
 *
 * The read cannot be skipped by holding a lock instead. There is no lock to
 * hold across isolates, and the one durable thing they share is the row being
 * written here.
 */
async function lostTheRace(sql: Sql, name: string): Promise<boolean> {
  try {
    const row = await sql
      .prepare('SELECT name FROM _migrations WHERE name = ?')
      .bind(name)
      .first<{ name: string }>()
    return row !== null
  } catch {
    // The ledger itself is unreadable, so we know nothing. Report the original
    // failure rather than guessing that this one excuses it.
    return false
  }
}

/**
 * Statement-at-a-time, for a migration that cannot run inside a transaction.
 *
 * `PRAGMA foreign_keys` is a no-op inside one — SQLite ignores it rather than
 * erroring — and `0009_tracking_off_by_default.sql` turns foreign keys off to
 * rebuild a table, so running it in a batch would silently enforce the
 * constraints it is trying to step around. Such a migration keeps the old
 * behaviour, and with it the old risk of a part-applied run; it is also the
 * shape that only ever runs against a database that already exists, where the
 * long first-request window that caused the brick does not apply.
 */
async function applyStepwise(sql: Sql, m: Migration, statements: string[]): Promise<boolean> {
  for (const statement of statements) {
    try {
      await sql.prepare(statement).run()
    } catch (err) {
      if (await lostTheRace(sql, m.name)) return false
      throw new Error(`migration ${m.name} failed on:\n${statement}\n\n${String(err)}`)
    }
  }
  try {
    await record(sql, m.name).run()
  } catch (err) {
    if (await lostTheRace(sql, m.name)) return false
    throw err
  }
  return true
}

const isPragma = (statement: string): boolean => /^\s*PRAGMA\b/i.test(statement)

/** Tables D1 and SQLite own. Dropping one is not ours to do. */
const isInternal = (name: string): boolean =>
  name === '_migrations' || name === 'd1_migrations' || /^(sqlite_|_cf_)/.test(name)

/**
 * Undoes a migration run that died part-way, and only one that cannot have
 * held data.
 *
 * Every instance bricked by the pre-`batch` behaviour above is still out there
 * in exactly that state, and the fix for new deployments does nothing for
 * them: their `_migrations` is empty, their schema is half-built, and the next
 * boot still re-runs 0000 into `already exists`. So the one case that is
 * provably safe to clear is cleared.
 *
 * The proof is narrow and it is the whole reason this is allowed to drop
 * tables. `_migrations` holds no rows and there is no `d1_migrations`, so no
 * migration has ever been recorded as complete by either runner. `migrate()`
 * is the first thing `ensureInstance` does and the workspace insert is the
 * second, so a database that never finished migrating never reached the code
 * that writes the first row — and the `workspaces` count below is the direct
 * check of that rather than an inference from it. A database that disagrees
 * with any part of that is left exactly as it is: the caller gets the honest
 * `already exists` failure instead of a silent reset, because an operator
 * staring at a migration error has lost nothing, and one whose rows were
 * dropped to make an error go away has lost everything.
 */
async function resetHalfAppliedSchema(sql: Sql): Promise<void> {
  const { results } = await sql
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all<{ name: string }>()
  const owned = results.map((r) => r.name).filter((name) => !isInternal(name))
  if (owned.length === 0) return

  // The one table that would make this destructive. Its absence is the common
  // case — the brick happens long before `workspaces` is created — and its
  // presence with a single row means this is a working database whose
  // `_migrations` was lost some other way, which is not ours to resolve.
  if (owned.includes('workspaces')) {
    const row = await sql.prepare('SELECT count(*) AS n FROM workspaces').first<{ n: number }>()
    if ((row?.n ?? 0) > 0) return
  }

  console.warn(
    `[migrate] A previous migration run left ${owned.length} table(s) behind and recorded none of them.\n` +
      '          The database holds no workspace, so it has never completed a boot; clearing it\n' +
      '          and applying every migration from the start.',
  )
  // One transaction, for the same reason as the migrations themselves: a
  // half-dropped schema is the state this exists to escape.
  await sql.batch(owned.map((name) => sql.prepare(`DROP TABLE IF EXISTS "${name}"`)))
}

/**
 * Splits a migration file into statements.
 *
 * Naive splitting on `;` breaks the moment a trigger body or a string literal
 * contains one, and drizzle-kit emits both — hence tracking quote state and
 * BEGIN…END nesting rather than a regex.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let inLineComment = false
  let inBlockComment = false
  let blockDepth = 0

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!
    const next = sql[i + 1]

    if (inLineComment) {
      if (c === '\n') inLineComment = false
      current += c
      continue
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false
        current += '*/'
        i++
        continue
      }
      current += c
      continue
    }
    if (!inSingle && !inDouble) {
      if (c === '-' && next === '-') {
        inLineComment = true
        current += c
        continue
      }
      if (c === '/' && next === '*') {
        inBlockComment = true
        current += '/*'
        i++
        continue
      }
    }

    if (c === "'" && !inDouble) inSingle = !inSingle
    else if (c === '"' && !inSingle) inDouble = !inDouble

    if (!inSingle && !inDouble) {
      const ahead = sql.slice(i).toUpperCase()
      if (/^BEGIN\b/.test(ahead) && /CREATE\s+TRIGGER/i.test(current)) blockDepth++
      else if (/^END\b/.test(ahead) && blockDepth > 0) blockDepth--
    }

    if (c === ';' && !inSingle && !inDouble && blockDepth === 0) {
      const trimmed = current.trim()
      if (trimmed) out.push(trimmed)
      current = ''
      continue
    }
    current += c
  }

  const tail = current.trim()
  if (tail) out.push(tail)
  return out.filter((s) => s.replace(/--[^\n]*/g, '').trim().length > 0)
}
