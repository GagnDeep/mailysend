import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

/**
 * Every SQL string in the server is checked against the real schema.
 *
 * TypeScript cannot see inside a template literal, so a column that was renamed
 * in a migration — or invented by a hand that never read one — typechecks
 * perfectly and fails at runtime, in production, on a path that may only run
 * once a day. Four separate column mismatches were already found by hand while
 * this app was being written; this test is what makes the fifth impossible.
 *
 * The approach is deliberately blunt: apply the migration to an in-memory
 * database, then ask SQLite to `EXPLAIN` every statement we ship. SQLite's own
 * parser is the only authority that cannot disagree with SQLite.
 */

const ROOT = new URL('../../..', import.meta.url).pathname
const SERVER = join(ROOT, 'apps/app/src/server')

const db = new DatabaseSync(':memory:')
// Every migration, in order — not just the first. Pinning this to `0000_init`
// meant the day a table arrived in `0001` the statements using it were reported
// as "no such table" by the very test whose job is to prove they are fine.
const MIGRATIONS = join(ROOT, 'packages/db/migrations')
for (const file of readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()) {
  const migration = readFileSync(join(MIGRATIONS, file), 'utf8')
  for (const statement of migration.split('--> statement-breakpoint')) {
    const trimmed = statement.trim()
    if (trimmed) db.exec(trimmed)
  }
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : []
  })
}

/**
 * Template literals are extracted with a scanner rather than a regex, because a
 * regex cannot see nesting: `UPDATE x SET ${keys.map((k) => `${k} = ?`)}` ends
 * at the *inner* backtick under any non-recursive pattern, and the truncated
 * half then fails to parse for a reason that has nothing to do with the schema.
 */
function literals(source: string): string[] {
  const found: string[] = []
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '`') continue
    const stack: Array<'tick' | 'brace'> = ['tick']
    let j = i + 1
    for (; j < source.length && stack.length > 0; j++) {
      const ch = source[j]
      if (ch === '\\') {
        j++
        continue
      }
      if (stack[stack.length - 1] === 'tick') {
        if (ch === '`') stack.pop()
        else if (ch === '$' && source[j + 1] === '{') {
          stack.push('brace')
          j++
        }
      } else if (ch === '{') stack.push('brace')
      else if (ch === '}') stack.pop()
      else if (ch === '`') stack.push('tick')
    }
    found.push(source.slice(i + 1, j - 1))
    i = j - 1
  }
  return found
}

/**
 * Prose in a doc comment can begin with a SQL verb, so the verb has to be
 * followed by the rest of its clause -- `DELETE FROM`, not the
 * `DELETE /v1/emails/:id` that heads a route comment.
 */
const SQL_LITERAL =
  /^\s*(?:SELECT\s[\s\S]*?\sFROM\s|INSERT\s+(?:OR\s+\w+\s+)?INTO\s|UPDATE\s+\w+\s+SET\s|DELETE\s+FROM\s|WITH\s+\w+\s+AS\s*\()/i

interface Statement {
  file: string
  raw: string
}

/**
 * A `${...}` is a fragment chosen at runtime, and what parses in its place
 * depends entirely on where it sits. The text immediately before it says which:
 * after `SELECT` or a comma it is a projection, after `WHERE`/`AND` a predicate,
 * after `SET` an assignment, after `BY` a column, and anywhere else -- typically
 * a `${cond ? 'AND x = ?' : ''}` tacked onto a finished clause -- nothing at
 * all. Substituting by position keeps the statement parseable without claiming
 * to know what the branch produces, so a wrong *column* still fails loudly.
 */
function substitute(raw: string): string {
  // `[^{}]|\{[^}]*\}` so a nested literal -- `${keys.map((k) => `${k} = ?`)}` --
  // is consumed whole rather than cut at its inner brace.
  return raw.replace(/\$\{(?:[^{}]|\{[^}]*\})*\}/g, (_match, offset: number) => {
    const before = raw.slice(0, offset).replace(/\s+$/, '').toUpperCase()
    if (/(?:SELECT|,)$/.test(before)) return '1'
    if (/\bSET$/.test(before)) return 'id = id'
    if (/(?:\b(?:WHERE|AND|OR|HAVING|ON)|\()$/.test(before)) return '1=1'
    if (/\bBY$/.test(before)) return 'id'
    if (/\bVALUES$/.test(before)) return '(1)'
    return ''
  })
}

const statements: Statement[] = []
for (const file of walk(SERVER)) {
  const source = readFileSync(file, 'utf8')
  for (const literal of literals(source)) {
    if (SQL_LITERAL.test(literal))
      statements.push({ file: file.slice(ROOT.length), raw: literal.trim() })
  }
}

describe('server SQL matches the shipped schema', () => {
  it('finds statements to check', () => {
    expect(statements.length).toBeGreaterThan(20)
  })

  for (const { file, raw } of statements) {
    it(`${file}: ${raw.replace(/\s+/g, ' ').slice(0, 70)}`, () => {
      const sql = substitute(raw)
      expect(() => db.prepare(sql)).not.toThrow()
    })
  }
})
