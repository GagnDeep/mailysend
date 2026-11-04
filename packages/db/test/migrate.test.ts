import type { SqlStatement } from '@mailysend/platform'
import { NodeSql } from '@mailysend/platform/node'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS, migrate, splitStatements } from '../src/migrate.ts'

/**
 * The embedded migrations run against two very different SQL drivers, and the
 * differences between them are not symmetric: anything node:sqlite accepts, D1
 * may not. These pin the D1 side, because the Node side is what every other
 * test in the repo already exercises — so a statement that only D1 rejects
 * otherwise ships green and fails on the first request of a one-click deploy.
 */

/**
 * A driver with D1's actual `exec` semantics: it splits its input on newlines
 * and requires each line to be a complete statement. A pretty, indented
 * multi-line DDL string passed to `exec` therefore fails with
 * `incomplete input` — which is exactly how the `_migrations` bootstrap broke
 * every Cloudflare request while passing every Node test.
 */
class D1LikeSql extends NodeSql {
  override async exec(sql: string): Promise<{ count: number; duration: number }> {
    for (const line of sql.split('\n')) {
      const statement = line.trim()
      if (!statement) continue
      if (!statement.endsWith(';') && !/^[A-Za-z].*\)$/.test(statement)) {
        throw new Error(`D1_EXEC_ERROR: Error in line 1: ${statement}: incomplete input`)
      }
    }
    return super.exec(sql)
  }
}

describe('migrate', () => {
  it('applies every embedded migration on a driver with D1 exec semantics', async () => {
    const sql = new D1LikeSql(':memory:')
    const { applied } = await migrate(sql)

    expect(applied.length).toBeGreaterThan(0)
    const { results } = await sql
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages'")
      .all<{ name: string }>()
    expect(results).toHaveLength(1)
  })

  it('is idempotent: a second run applies nothing', async () => {
    const sql = new D1LikeSql(':memory:')
    const first = await migrate(sql)
    const second = await migrate(sql)

    expect(second.applied).toEqual([])
    expect(second.skipped).toEqual(first.applied)
  })

  it('skips what wrangler d1 migrations apply already ran, and runs the rest', async () => {
    const sql = new D1LikeSql(':memory:')
    const all = await migrate(new D1LikeSql(':memory:'))
    // As wrangler leaves a database: the first migration applied, and recorded
    // only in d1_migrations.
    const [first, ...rest] = MIGRATIONS
    await migrate(sql, [first!])
    await sql.prepare('DROP TABLE _migrations').run()
    await sql
      .prepare(
        'CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)',
      )
      .run()
    await sql.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(first!.name).run()

    const { applied, skipped } = await migrate(sql)

    expect(skipped).toEqual([first!.name])
    expect(applied).toEqual(rest.map((m) => m.name))
    expect(applied.length + skipped.length).toBe(all.applied.length)
    const again = await migrate(sql)
    expect(again.applied).toEqual([])
  })

  /**
   * The failure this pair exists for bricked a real deployment. 0000_init.sql
   * is 122 statements; applied one at a time against remote D1 the first
   * request of a fresh instance spent ~15s in the migration, the client gave
   * up, Cloudflare cancelled the isolate, and the database kept the first
   * nineteen tables with nothing recorded in `_migrations`. Every request after
   * that re-ran 0000 and died on `table api_keys already exists` — a 500 on
   * every route, `/v1/health` included, permanently.
   */
  it('recovers a first run that died part-way through', async () => {
    const sql = new D1LikeSql(':memory:')
    await sql
      .prepare(
        'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
      )
      .run()
    // Exactly how the cancelled isolate left it: some of the first migration
    // applied, and no row to say so.
    for (const statement of splitStatements(MIGRATIONS[0]!.sql).slice(0, 19)) {
      await sql.prepare(statement).run()
    }

    const { applied } = await migrate(sql)

    expect(applied).toEqual(MIGRATIONS.map((m) => m.name))
    const { results } = await sql
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages'")
      .all<{ name: string }>()
    expect(results).toHaveLength(1)
  })

  it('refuses to clear a database that holds a workspace, and says why', async () => {
    const sql = new D1LikeSql(':memory:')
    await migrate(sql)
    await sql
      .prepare('INSERT INTO workspaces (id, name, slug, plan, created_at) VALUES (?,?,?,?,?)')
      .bind('ws_1', 'Real', 'real', 'self_hosted', new Date().toISOString())
      .run()
    // A database with data whose ledger went missing is not a half-applied
    // run, and must not be treated as one.
    await sql.prepare('DELETE FROM _migrations').run()

    await expect(migrate(sql)).rejects.toThrow(/already exists/)

    const row = await sql.prepare('SELECT count(*) AS n FROM workspaces').first<{ n: number }>()
    expect(row?.n).toBe(1)
  })

  it('rolls a failing migration back whole, leaving nothing recorded', async () => {
    const sql = new D1LikeSql(':memory:')
    const bad = {
      name: '9999_bad.sql',
      sql: 'CREATE TABLE half_landed (id TEXT);\nCREATE TABLE half_landed (id TEXT);',
    }

    await expect(migrate(sql, [bad])).rejects.toThrow(/rolled back/)

    const { results } = await sql
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'half_landed'")
      .all<{ name: string }>()
    expect(results).toEqual([])
    const row = await sql.prepare('SELECT count(*) AS n FROM _migrations').first<{ n: number }>()
    expect(row?.n).toBe(0)
  })

  /**
   * A cold deployment answers its first requests in several isolates at once,
   * each of which reads the applied-migration list before any of them commits.
   * The loser of that race used to surface the collision as a failure — a real
   * instance returned 503 with `duplicate column name: origin` on its first
   * request and 200 on its second — when the correct answer is that the
   * migration is applied and it was simply not the one who applied it.
   */
  it('treats a migration another runner committed first as applied, not failed', async () => {
    class RacingSql extends D1LikeSql {
      raced = false
      override async batch<T = unknown>(statements: SqlStatement[]) {
        if (!this.raced) {
          this.raced = true
          // The winning isolate commits while this batch is in flight, so this
          // one rolls back against a database that is already correct.
          await this.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)')
            .bind(MIGRATIONS[0]!.name, new Date().toISOString())
            .run()
          throw new Error('D1_ERROR: table `api_keys` already exists at offset 13: SQLITE_ERROR')
        }
        return super.batch<T>(statements)
      }
    }
    const sql = new RacingSql(':memory:')

    const { applied, skipped } = await migrate(sql, [MIGRATIONS[0]!])

    expect(applied).toEqual([])
    expect(skipped).toEqual([MIGRATIONS[0]!.name])
  })
})
