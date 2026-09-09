import type { Sql } from '@mailysend/platform'
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
  await sql.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`,
  )

  const { results } = await sql.prepare('SELECT name FROM _migrations').all<{ name: string }>()
  const done = new Set(results.map((r) => r.name))

  const applied: string[] = []
  const skipped: string[] = []

  for (const m of migrations) {
    if (done.has(m.name)) {
      skipped.push(m.name)
      continue
    }
    // Statement-at-a-time rather than one `exec`: D1's exec has a size ceiling,
    // and a per-statement failure names the statement that broke.
    for (const statement of splitStatements(m.sql)) {
      try {
        await sql.prepare(statement).run()
      } catch (err) {
        throw new Error(`migration ${m.name} failed on:\n${statement}\n\n${String(err)}`)
      }
    }
    await sql
      .prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)')
      .bind(m.name, new Date().toISOString())
      .run()
    applied.push(m.name)
  }

  return { applied, skipped }
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
