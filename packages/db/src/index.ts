import type { Sql } from '@mailysend/platform'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema/index.ts'

export { MIGRATIONS, migrate } from './migrate.ts'
export * as schema from './schema/index.ts'

/**
 * Drizzle over the platform's `Sql`.
 *
 * `drizzle-orm/d1` is used on both runtimes because `Sql` was specified as a
 * subset of `D1Database` — the Node adapter satisfies the same shape, so the
 * query builder does not need to know which runtime it is on.
 */
export const db = (sql: Sql) => drizzle(sql as never, { schema, casing: 'snake_case' })

export type Db = ReturnType<typeof db>
