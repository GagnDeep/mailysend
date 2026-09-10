/**
 * The mail search grammar.
 *
 * `from:ana subject:"invoice 12" has:attachment is:unread in:archive before:2026-01-01 refund`
 *
 * Parsing happens here and compilation happens here, in one file, for the same
 * reason the segment DSL does: the only way a query built from user text can be
 * safe is if user text never reaches the SQL string. An operator resolves to a
 * column through a fixed registry — a name that is not in the registry is not a
 * column, it is free text — and every value leaves as a bound parameter. There
 * is no code path in which a value is concatenated, so injection is not
 * defended against, it is unrepresentable.
 */

export interface MailQuery {
  /** `WHERE` fragments, already parameterised. Joined with AND by the caller. */
  where: string[]
  params: unknown[]
  /** The FTS5 MATCH expression, or null when the query was operators only. */
  match: string | null
  /** Echoed back so the UI can render the parsed query as chips. */
  terms: { operator: string | null; value: string; negated: boolean }[]
}

/**
 * Operator → column, and how the value is compared.
 *
 * `table` is `t` for `mail_threads` and `m` for `mail_messages`; the caller
 * aliases them that way. Nothing outside this object can name a column.
 */
const OPERATORS: Record<
  string,
  { sql: string; compare: 'like' | 'eq' | 'lt' | 'gt' | 'json'; map?: (v: string) => string }
> = {
  from: { sql: 'm.from_address', compare: 'like' },
  to: { sql: 'm.to_addresses', compare: 'like' },
  subject: { sql: 't.subject', compare: 'like' },
  in: { sql: 't.folder', compare: 'eq', map: (v) => (v === 'sent' ? 'sent' : v) },
  folder: { sql: 't.folder', compare: 'eq' },
  label: { sql: 't.labels', compare: 'json' },
  before: { sql: 't.last_message_at', compare: 'lt' },
  after: { sql: 't.last_message_at', compare: 'gt' },
  mailbox: { sql: 't.mailbox_id', compare: 'eq' },
}

/** `is:` and `has:` are closed vocabularies, so they get their own registry. */
const FLAGS: Record<string, string> = {
  'is:unread': 't.unread_count > 0',
  'is:read': 't.unread_count = 0',
  'is:starred': 't.starred = 1',
  'is:unstarred': 't.starred = 0',
  'is:snoozed': 't.snoozed_until IS NOT NULL',
  'is:sent': "t.last_direction = 'out'",
  'is:received': "t.last_direction = 'in'",
  'has:attachment': 't.has_attachments = 1',
  'has:attachments': 't.has_attachments = 1',
}

const VALID_FOLDERS = new Set(['inbox', 'sent', 'archive', 'spam', 'trash'])

interface Token {
  operator: string | null
  value: string
  negated: boolean
}

/** Splits on whitespace but keeps `"quoted phrases"` together. */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  const pattern = /(-?)(?:([a-z_]+):)?(?:"([^"]*)"|(\S+))/gi
  for (const match of input.matchAll(pattern)) {
    const value = (match[3] ?? match[4] ?? '').trim()
    if (value === '') continue
    const operator = match[2]?.toLowerCase() ?? null
    tokens.push({ operator, value, negated: match[1] === '-' })
  }
  return tokens
}

export function compileMailQuery(input: string): MailQuery {
  const tokens = tokenize(input)
  const where: string[] = []
  const params: unknown[] = []
  const free: string[] = []

  for (const token of tokens) {
    if (!token.operator) {
      free.push(token.value)
      continue
    }

    const flagKey = `${token.operator}:${token.value.toLowerCase()}`
    const flag = FLAGS[flagKey]
    if (flag) {
      where.push(token.negated ? `NOT (${flag})` : flag)
      continue
    }

    const spec = OPERATORS[token.operator]
    if (!spec) {
      // An operator we do not know is not an error and is certainly not a
      // column: it is text somebody typed with a colon in it.
      free.push(`${token.operator}:${token.value}`)
      continue
    }

    const value = spec.map ? spec.map(token.value) : token.value
    if (spec.compare === 'eq' && spec.sql === 't.folder' && !VALID_FOLDERS.has(value)) {
      free.push(token.value)
      continue
    }

    switch (spec.compare) {
      case 'like':
        where.push(negate(token, `${spec.sql} LIKE ? ESCAPE '\\'`))
        params.push(`%${escapeLike(value)}%`)
        break
      case 'eq':
        where.push(negate(token, `${spec.sql} = ?`))
        params.push(value)
        break
      case 'lt':
        where.push(negate(token, `${spec.sql} < ?`))
        params.push(normalizeDate(value))
        break
      case 'gt':
        where.push(negate(token, `${spec.sql} > ?`))
        params.push(normalizeDate(value))
        break
      case 'json':
        // Labels are a JSON array on the thread. `LIKE` on the serialised form
        // is exact enough because ids are opaque and quoted.
        where.push(negate(token, `${spec.sql} LIKE ? ESCAPE '\\'`))
        params.push(`%"${escapeLike(value)}"%`)
        break
    }
  }

  return { where, params, match: ftsMatch(free), terms: tokens }
}

const negate = (token: Token, clause: string): string =>
  token.negated ? `NOT (${clause})` : clause

/**
 * `%` and `_` are wildcards in LIKE, so a value carrying either would widen the
 * pattern the reader asked for. They are escaped rather than stripped: every id
 * in this product contains an underscore, and stripping meant `label:lbl_123`
 * searched for `lbl123` and matched nothing it was pointed at. The clauses that
 * use this pair it with `ESCAPE '\\'`.
 */
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, '\\$&')

/**
 * A date operator accepts `2026-01-01` or a relative `7d`. Anything else is
 * passed through: the comparison is against ISO-8601 text, so a malformed date
 * simply matches nothing rather than becoming a syntax error.
 */
function normalizeDate(value: string): string {
  const relative = /^(\d+)([dhw])$/.exec(value)
  if (relative) {
    const n = Number(relative[1])
    const ms = relative[2] === 'h' ? 3_600_000 : relative[2] === 'w' ? 604_800_000 : 86_400_000
    return new Date(Date.now() - n * ms).toISOString()
  }
  return value
}

/**
 * FTS5 treats a dozen punctuation characters as operators, so free text is
 * quoted into phrases. A user typing `refund AND NOT` gets a search for those
 * three words rather than a syntax error from a query language they were never
 * told about.
 */
export function ftsMatch(terms: string[]): string | null {
  const cleaned = terms.map((t) => t.replace(/"/g, '').trim()).filter((t) => t.length > 0)
  if (cleaned.length === 0) return null
  return cleaned.map((t) => `"${t}"`).join(' ')
}

/** The operator list, for the search box's inline help and autocomplete. */
export const SEARCH_OPERATORS: { operator: string; example: string; description: string }[] = [
  { operator: 'from:', example: 'from:ana@acme.dev', description: 'Sender address contains' },
  { operator: 'to:', example: 'to:support', description: 'Any recipient contains' },
  { operator: 'subject:', example: 'subject:"invoice 12"', description: 'Subject contains' },
  { operator: 'has:', example: 'has:attachment', description: 'Conversation has attachments' },
  { operator: 'is:', example: 'is:unread', description: 'unread · read · starred · snoozed' },
  { operator: 'label:', example: 'label:lbl_123', description: 'Carries this label' },
  { operator: 'in:', example: 'in:archive', description: 'inbox · sent · archive · spam · trash' },
  { operator: 'before:', example: 'before:2026-01-01', description: 'Older than a date or 7d' },
  { operator: 'after:', example: 'after:30d', description: 'Newer than a date or 30d' },
  { operator: '-', example: '-from:noreply', description: 'Negates any operator' },
]
