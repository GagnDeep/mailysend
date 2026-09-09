import { integer, text } from 'drizzle-orm/sqlite-core'

/**
 * Columns that appear on nearly every table.
 *
 * `workspaceId` is on all of them, unconditionally, in both single-tenant and
 * multi-tenant deployments — see packages/core/src/tenancy.ts for why that is
 * non-negotiable. Every index in this schema starts with it.
 */
export const workspaceId = () => text('workspace_id').notNull()

/** ISO-8601 strings, not epoch integers: readable in a `sqlite3` shell, and D1's
 *  own tooling renders them. Sorting is identical because ISO-8601 sorts. */
export const createdAt = () =>
  text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString())

export const updatedAt = () =>
  text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString())

/** SQLite has no boolean; 0/1 with a typed accessor keeps call sites honest. */
export const bool = (name: string) => integer(name, { mode: 'boolean' })

/** Free-form JSON blobs. Parsed at the edge of the data layer, never deeper. */
export const json = (name: string) => text(name, { mode: 'json' })
