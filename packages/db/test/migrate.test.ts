import { NodeSql } from '@mailysend/platform/node'
import { describe, expect, it } from 'vitest'
import { migrate } from '../src/migrate.ts'

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
})
