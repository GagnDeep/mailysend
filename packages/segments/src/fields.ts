/**
 * The column registry.
 *
 * This map is the entire security boundary of the DSL. A compiled segment can
 * only ever name a column that appears here — an identifier the parser cannot
 * resolve against this table is a syntax error, never a string that reaches
 * SQL. Everything else in an expression (literals, `in` lists, JSON paths,
 * LIKE patterns) is a bound parameter. There is deliberately no escape hatch,
 * no "raw" node, and no place where user text is concatenated into a query.
 *
 * `nullable` is not documentation: it decides whether a comparison needs a
 * NULL guard so that `not <predicate>` means what a marketer thinks it means.
 * See compile.ts.
 */

export type FieldType = 'string' | 'number' | 'boolean' | 'timestamp'

export interface ColumnDef {
  /** The physical column. Never derived from user input. */
  sql: string
  type: FieldType
  nullable: boolean
  /** Used by describe.ts. Kept next to the column so the two cannot drift. */
  label: string
}

export const COLUMNS = {
  email: { sql: 'email', type: 'string', nullable: false, label: 'email' },
  first_name: { sql: 'first_name', type: 'string', nullable: true, label: 'first name' },
  last_name: { sql: 'last_name', type: 'string', nullable: true, label: 'last name' },
  unsubscribed: { sql: 'unsubscribed', type: 'boolean', nullable: false, label: 'unsubscribed' },
  open_count: { sql: 'open_count', type: 'number', nullable: false, label: 'open count' },
  click_count: { sql: 'click_count', type: 'number', nullable: false, label: 'click count' },
  send_count: { sql: 'send_count', type: 'number', nullable: false, label: 'send count' },
  bounce_count: { sql: 'bounce_count', type: 'number', nullable: false, label: 'bounce count' },
  last_open_at: { sql: 'last_open_at', type: 'timestamp', nullable: true, label: 'last open' },
  last_click_at: { sql: 'last_click_at', type: 'timestamp', nullable: true, label: 'last click' },
  last_send_at: { sql: 'last_send_at', type: 'timestamp', nullable: true, label: 'last send' },
  created_at: { sql: 'created_at', type: 'timestamp', nullable: false, label: 'creation date' },
} as const satisfies Record<string, ColumnDef>

export type ColumnName = keyof typeof COLUMNS

export const isColumn = (name: string): name is ColumnName =>
  Object.hasOwn(COLUMNS, name) && name !== '__proto__'

export const columnNames = (): ColumnName[] => Object.keys(COLUMNS) as ColumnName[]

/** The JSON column holding custom merge fields. Also fixed, for the same reason. */
export const DATA_COLUMN = 'data'
