import { describe, expect, it } from 'vitest'
import { SegmentError } from '../src/ast.ts'
import { compileExpression, relativeWindows } from '../src/compile.ts'
import { parse } from '../src/parser.ts'

const NOW = new Date('2026-09-09T12:00:00.000Z')
const at = (source: string) => compileExpression(source, { now: NOW })

const rejects = (source: string): SegmentError => {
  try {
    at(source)
  } catch (err) {
    if (err instanceof SegmentError) return err
    throw err
  }
  throw new Error(`expected '${source}' to be rejected`)
}

/**
 * The `ESCAPE '\'` clause is the one place the compiler emits a quote, and it
 * is a constant. Everything else must be free of quotes and of SQL structure.
 */
const withoutEscapeClause = (sql: string) => sql.replaceAll(" ESCAPE '\\'", '')

describe('compilation', () => {
  it('binds every literal', () => {
    expect(at("email = 'a@b.com'")).toEqual({
      sql: '(email = ?)',
      params: ['a@b.com'],
      dependsOn: ['email'],
    })
  })

  it('resolves durations against the supplied clock, not the AST', () => {
    expect(at('last_open_at > 30d').params).toEqual(['2026-08-10T12:00:00.000Z'])
    // The same AST compiled an hour later yields a different bound value, which
    // is what lets a cached parse be reused by the hourly sweep.
    const ast = parse('last_open_at > 30d')
    const later = new Date(NOW.getTime() + 3_600_000)
    expect(compileExpression('last_open_at > 30d', { now: later }).params).not.toEqual(
      compileExpression('last_open_at > 30d', { now: NOW }).params,
    )
    expect(ast).toMatchObject({ value: { kind: 'duration', duration: { ms: 30 * 86_400_000 } } })
  })

  it('guards nullable columns so `not` means what a marketer expects', () => {
    // Without the IS NOT NULL guard, NOT(NULL > x) is NULL and everyone who has
    // never clicked would be dropped from "has not clicked recently".
    expect(at('not clicked_last_7d').sql).toBe(
      '(NOT (last_click_at IS NOT NULL AND last_click_at > ?))',
    )
    expect(at('open_count > 0').sql).toBe('(open_count > ?)')
  })

  it('compiles boolean columns to 0/1', () => {
    expect(at('unsubscribed').params).toEqual([1])
    expect(at('subscribed').params).toEqual([0])
  })

  it('escapes LIKE wildcards in the pattern, not in the query', () => {
    expect(at("email contains 'a%b_c'")).toEqual({
      sql: "(email LIKE ? ESCAPE '\\')",
      params: ['%a\\%b\\_c%'],
      dependsOn: ['email'],
    })
    expect(at("email starts_with 'a'").params).toEqual(['a%'])
    expect(at("email ends_with 'a'").params).toEqual(['%a'])
  })

  it('compiles in-lists and null tests', () => {
    expect(at("email in ['a', 'b']")).toMatchObject({
      sql: '(email IN (?, ?))',
      params: ['a', 'b'],
    })
    expect(at('first_name is null').sql).toBe('(first_name IS NULL)')
    expect(at('first_name is not null').sql).toBe('(first_name IS NOT NULL)')
  })

  it('compiles boolean structure with explicit parentheses', () => {
    expect(at('subscribed and (bounced or never_opened)').sql).toBe(
      '((unsubscribed = ?) AND ((bounce_count > ?) OR (open_count = ?)))',
    )
  })

  it('expands every sugar predicate to a real comparison', () => {
    expect(at('opened_last_30d')).toMatchObject({
      sql: '(last_open_at IS NOT NULL AND last_open_at > ?)',
      params: ['2026-08-10T12:00:00.000Z'],
    })
    expect(at('clicked_last_12h').params).toEqual(['2026-09-09T00:00:00.000Z'])
    expect(at('sent_last_2w').params).toEqual(['2026-08-26T12:00:00.000Z'])
    expect(at('never_opened').sql).toBe('(open_count = ?)')
    expect(at('never_clicked')).toMatchObject({ sql: '(click_count = ?)', params: [0] })
    expect(at('bounced')).toMatchObject({ sql: '(bounce_count > ?)', params: [0] })
    // There is no last_bounce_at column, so a windowed bounce degrades to "ever".
    expect(at('bounced_last_30d').sql).toBe('(bounce_count > ?)')
  })
})

describe('dependsOn', () => {
  it('lists exactly the fields read, sorted and deduplicated', () => {
    expect(at('opened_last_30d and not clicked_last_7d').dependsOn).toEqual([
      'last_click_at',
      'last_open_at',
    ])
    expect(at('never_opened or never_clicked').dependsOn).toEqual(['click_count', 'open_count'])
    expect(at('subscribed').dependsOn).toEqual(['unsubscribed'])
    expect(at('bounced').dependsOn).toEqual(['bounce_count'])
    expect(at('open_count > 1 and open_count < 9').dependsOn).toEqual(['open_count'])
  })

  it('names custom fields by their full path', () => {
    expect(at("data.plan = 'pro' and data.billing.seats > 2").dependsOn).toEqual([
      'data.billing.seats',
      'data.plan',
    ])
    expect(at('data["seat count"] > 2').dependsOn).toEqual(['data.seat count'])
  })

  it('reaches into every branch of the tree', () => {
    const deps = at(
      "(email contains 'a' or first_name is null) and not (created_at > 1d)",
    ).dependsOn
    expect(deps).toEqual(['created_at', 'email', 'first_name'])
  })
})

describe('type checking', () => {
  it('rejects mismatched literal types', () => {
    expect(rejects("open_count = 'ten'").message).toBe('open count is a number, not text')
    expect(rejects('email = 3').message).toBe('email is text, not a number')
    expect(rejects('unsubscribed = 3').message).toBe('unsubscribed is true or false, not a number')
    expect(rejects('last_open_at > 3').message).toContain('compare it to a duration')
  })

  it('rejects durations against non-date fields', () => {
    expect(rejects('open_count > 30d').message).toBe(
      'a duration like 30d only compares against a date field',
    )
  })

  it('rejects text operators on non-text fields', () => {
    expect(rejects("open_count contains 'a'").message).toBe(
      "'contains' needs a text field, but open count is a number",
    )
    expect(rejects('email contains 3').message).toBe(
      "'contains' needs a quoted string on the right",
    )
  })

  it('steers null comparisons to `is null`', () => {
    expect(rejects('email = null').message).toBe("use 'is null' rather than '= null'")
    expect(rejects("email in ['a', null]").message).toBe(
      "'in' lists cannot contain null — use 'is null'",
    )
  })

  it('carries an offset and a kind on type errors too', () => {
    const err = rejects("subscribed and open_count = 'ten'")
    expect(err.kind).toBe('type')
    expect(err.offset).toBe(15)
  })

  it('accepts anything against a custom field, whose type is unknown until runtime', () => {
    expect(at("data.plan = 'pro'").params.at(-1)).toBe('pro')
    expect(at('data.seats = 3').params.at(-1)).toBe(3)
    expect(at('data.trial = true').params.at(-1)).toBe(1)
    expect(at('data.last_seen > 7d').params.at(-1)).toBe('2026-09-02T12:00:00.000Z')
  })
})

/**
 * These are the tests that justify the design. The DSL is authored by users and
 * stored verbatim; if any of them can move a character into the query text, the
 * whole feature is a SQL injection endpoint.
 */
describe('injection resistance', () => {
  const PAYLOADS = [
    "'; DROP TABLE contacts; --",
    "' OR '1'='1",
    "\\' OR 1=1 --",
    'x") OR json_extract(data, "$.a") IS NOT NULL --',
    "1); DELETE FROM segment_members WHERE ('1'='1",
    '%\\_%',
    'union select id, workspace_id from api_keys',
  ]

  it('turns a hostile string literal into an inert parameter', () => {
    for (const payload of PAYLOADS) {
      const compiled = at(`email = ${JSON.stringify(payload)}`)
      expect(compiled.sql).toBe('(email = ?)')
      expect(compiled.params).toEqual([payload])
      expect(withoutEscapeClause(compiled.sql)).not.toMatch(/['"]/)
    }
  })

  it('turns a hostile custom field name into a bound json path', () => {
    for (const payload of PAYLOADS.filter((p) => !p.includes('"') && !p.includes('\\'))) {
      const compiled = at(`data[${JSON.stringify(payload)}] = 1`)
      expect(compiled.sql).toBe('(json_extract(data, ?) IS NOT NULL AND json_extract(data, ?) = ?)')
      expect(compiled.params).toEqual([`$."${payload}"`, `$."${payload}"`, 1])
      expect(withoutEscapeClause(compiled.sql)).not.toMatch(/['"]/)
    }
  })

  it('refuses a custom field name that could break out of a json path', () => {
    expect(rejects('data["a\\"b"] = 1').message).toBe('custom field names cannot contain " or \\')
    expect(rejects('data["a\\\\b"] = 1').message).toBe('custom field names cannot contain " or \\')
  })

  it('refuses a hostile identifier at parse time — it never reaches the compiler', () => {
    for (const source of [
      'contacts; DROP TABLE contacts = 1',
      '1=1 or 1',
      'email) OR (1=1',
      "(select 1) = 'x'",
      'workspace_id = "other"',
      'rowid > 0',
    ]) {
      expect(() => at(source)).toThrow(SegmentError)
    }
  })

  it('never emits a quote or a statement separator for any accepted expression', () => {
    const sources = [
      "email contains '; drop table x --'",
      "first_name in ['a\\'b', '\\\\']",
      'data["a; b"] is not null',
      'opened_last_30d and not (never_clicked or unsubscribed)',
    ]
    for (const source of sources) {
      const compiled = at(source)
      const bare = withoutEscapeClause(compiled.sql)
      expect(bare).not.toMatch(/['";]/)
      expect(bare).not.toMatch(/--/)
      // Placeholders and bound values stay in step, which is what makes the
      // query text independent of anything the user wrote.
      expect((compiled.sql.match(/\?/g) ?? []).length).toBe(compiled.params.length)
    }
  })

  it('keeps placeholder count equal to parameter count for compound expressions', () => {
    const compiled = at(
      "data.plan in ['a', 'b'] and data['x'] contains 'y' and email starts_with 'z'",
    )
    expect((compiled.sql.match(/\?/g) ?? []).length).toBe(compiled.params.length)
  })
})

describe('relativeWindows', () => {
  it('finds the predicates that drift with the clock', () => {
    expect(relativeWindows(parse('opened_last_30d and not clicked_last_7d'))).toEqual([
      { column: 'last_open_at', ms: 30 * 86_400_000 },
      { column: 'last_click_at', ms: 7 * 86_400_000 },
    ])
  })

  it('deduplicates identical windows', () => {
    expect(relativeWindows(parse('opened_last_30d or last_open_at > 30d'))).toHaveLength(1)
  })

  it('returns nothing for an expression that cannot drift', () => {
    expect(relativeWindows(parse('never_opened and unsubscribed'))).toEqual([])
    // An absolute date is fixed, so it never needs a sweep.
    expect(relativeWindows(parse("last_open_at > '2026-01-01'"))).toEqual([])
  })
})
