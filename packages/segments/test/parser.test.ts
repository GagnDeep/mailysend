import { describe, expect, it } from 'vitest'
import type { Sugar } from '../src/ast.ts'
import { SegmentError } from '../src/ast.ts'
import { parse, tokenize } from '../src/parser.ts'

const sugarOf = (source: string): Sugar => {
  const node = parse(source)
  if (node.type !== 'sugar') throw new Error(`'${source}' did not parse as sugar`)
  return node.sugar
}

/** Asserts both the message and the caret position, since the UI shows both. */
const failure = (source: string): { message: string; offset: number; kind: string } => {
  try {
    parse(source)
  } catch (err) {
    if (err instanceof SegmentError)
      return { message: err.message, offset: err.offset, kind: err.kind }
    throw err
  }
  throw new Error(`expected '${source}' to fail parsing`)
}

describe('tokenizer', () => {
  it('reads strings in either quote style, with escapes', () => {
    expect(tokenize(`'a'`)[0]).toMatchObject({ type: 'string', text: 'a' })
    expect(tokenize(`"a b"`)[0]).toMatchObject({ type: 'string', text: 'a b' })
    expect(tokenize(`'it\\'s'`)[0]).toMatchObject({ type: 'string', text: "it's" })
  })

  it('distinguishes numbers from durations', () => {
    expect(tokenize('30')[0]).toMatchObject({ type: 'number', number: 30 })
    expect(tokenize('30d')[0]!.duration).toEqual({ count: 30, unit: 'd', ms: 30 * 86_400_000 })
    expect(tokenize('12h')[0]!.duration!.ms).toBe(12 * 3_600_000)
    expect(tokenize('4w')[0]!.duration!.ms).toBe(4 * 604_800_000)
    expect(tokenize('1.5')[0]).toMatchObject({ type: 'number', number: 1.5 })
  })

  it('records an offset on every token', () => {
    expect(tokenize('  email  =  1').map((t) => t.offset)).toEqual([2, 9, 12, 13])
  })
})

describe('parser', () => {
  it('parses boolean operators with the expected precedence', () => {
    expect(parse('never_opened or subscribed and unsubscribed')).toMatchObject({
      type: 'or',
      right: { type: 'and' },
    })
    expect(parse('(never_opened or subscribed) and unsubscribed')).toMatchObject({
      type: 'and',
      left: { type: 'or' },
    })
  })

  it('binds `not` tighter than `and`', () => {
    expect(parse('not subscribed and unsubscribed')).toMatchObject({
      type: 'and',
      left: { type: 'not' },
    })
  })

  it('nests `and` leftwards', () => {
    expect(parse('subscribed and subscribed and subscribed')).toMatchObject({
      type: 'and',
      left: { type: 'and' },
      right: { type: 'sugar' },
    })
  })

  it('parses every comparison operator', () => {
    for (const [source, op] of [
      ['open_count = 1', '='],
      ['open_count == 1', '='],
      ['open_count != 1', '!='],
      ['open_count <> 1', '!='],
      ['open_count > 1', '>'],
      ['open_count >= 1', '>='],
      ['open_count < 1', '<'],
      ['open_count <= 1', '<='],
      ["email contains 'a'", 'contains'],
      ["email starts_with 'a'", 'starts_with'],
      ["email ends_with 'a'", 'ends_with'],
    ] as const) {
      expect(parse(source)).toMatchObject({ type: 'compare', op })
    }
  })

  it('parses in-lists, is null and is not null', () => {
    expect(parse("email in ['a', 'b']")).toMatchObject({
      type: 'in',
      values: [{ value: 'a' }, { value: 'b' }],
    })
    expect(parse('first_name is null')).toMatchObject({ type: 'isNull', negated: false })
    expect(parse('first_name is not null')).toMatchObject({ type: 'isNull', negated: true })
  })

  it('parses custom fields in both syntaxes, including nesting', () => {
    expect(parse("data.plan = 'pro'")).toMatchObject({
      type: 'compare',
      field: { kind: 'data', path: ['plan'] },
    })
    expect(parse('data["seat count"] > 3')).toMatchObject({
      field: { kind: 'data', path: ['seat count'] },
    })
    expect(parse("data.billing.plan = 'pro'")).toMatchObject({
      field: { kind: 'data', path: ['billing', 'plan'] },
    })
  })

  it('treats a bare boolean column as a predicate', () => {
    expect(parse('unsubscribed')).toMatchObject({
      type: 'compare',
      field: { kind: 'column', name: 'unsubscribed' },
      op: '=',
      value: { kind: 'boolean', value: true },
    })
  })

  it('parses literals of every kind', () => {
    expect(parse('unsubscribed = false')).toMatchObject({
      value: { kind: 'boolean', value: false },
    })
    expect(parse('last_open_at > 30d')).toMatchObject({ value: { kind: 'duration' } })
    expect(parse("last_open_at > '2026-01-01'")).toMatchObject({ value: { kind: 'string' } })
  })

  it('is case-insensitive for keywords and field names', () => {
    expect(parse('SUBSCRIBED AND NOT Unsubscribed')).toMatchObject({ type: 'and' })
  })
})

describe('sugar', () => {
  it('accepts an arbitrary count and unit', () => {
    expect(parse('opened_last_30d')).toMatchObject({
      type: 'sugar',
      sugar: { kind: 'recent', event: 'opened', window: { count: 30, unit: 'd' } },
    })
    expect(sugarOf('clicked_last_7d')).toMatchObject({ event: 'clicked' })
    expect(sugarOf('sent_last_90d')).toMatchObject({ event: 'sent' })
    expect(sugarOf('opened_last_12h')).toMatchObject({ window: { count: 12, unit: 'h' } })
    expect(sugarOf('clicked_last_4w')).toMatchObject({ window: { count: 4, unit: 'w' } })
  })

  it('parses the wordless predicates', () => {
    expect(sugarOf('never_opened')).toEqual({ kind: 'never', event: 'opened' })
    expect(sugarOf('never_clicked')).toEqual({ kind: 'never', event: 'clicked' })
    expect(sugarOf('subscribed')).toEqual({ kind: 'subscribed' })
    expect(sugarOf('bounced')).toEqual({ kind: 'bounced' })
  })

  it('lets a real column win over a sugar name', () => {
    // `unsubscribed` is a column, so it must not be read as sugar.
    expect(parse('unsubscribed').type).toBe('compare')
  })
})

describe('errors', () => {
  it('rejects an empty expression', () => {
    expect(failure('')).toMatchObject({ message: 'expression is empty', offset: 0 })
    expect(failure('   ').offset).toBe(0)
  })

  it('reports an unterminated string at the opening quote', () => {
    expect(failure("email = 'abc")).toMatchObject({
      message: 'unterminated string literal',
      offset: 8,
    })
  })

  it('reports an unknown field and suggests a near miss', () => {
    const e = failure('emial = 1')
    expect(e.message).toBe("unknown field 'emial' — did you mean 'email'?")
    expect(e.offset).toBe(0)
    expect(failure('zzzzzzzzzz = 1').message).toBe("unknown field 'zzzzzzzzzz'")
  })

  it('reports an unclosed group', () => {
    expect(failure('(subscribed')).toMatchObject({
      message: "expected ')' to close the group, found the end of the expression",
      offset: 11,
    })
  })

  it('reports trailing input', () => {
    expect(failure('subscribed subscribed')).toMatchObject({
      message: "unexpected 'subscribed' after a complete expression",
      offset: 11,
    })
  })

  it('reports a missing operand after a connective', () => {
    expect(failure('subscribed and')).toMatchObject({
      message: 'expected a field or predicate, found the end of the expression',
      offset: 14,
    })
    expect(failure('not')).toMatchObject({ offset: 3 })
  })

  it('reports a missing value after an operator', () => {
    expect(failure('open_count >')).toMatchObject({
      message: 'expected a value, found the end of the expression',
      offset: 12,
    })
  })

  it('reports an unquoted word where a value belongs', () => {
    expect(failure('email = pro')).toMatchObject({
      message: "expected a value, found 'pro' — quote it if you meant a string",
      offset: 8,
    })
  })

  it('reports a malformed in-list', () => {
    expect(failure("email in 'a'").message).toBe(
      "expected '[' to start the 'in' list, found the string 'a'",
    )
    expect(failure('email in []').message).toBe("'in' needs at least one value")
    expect(failure("email in ['a'").message).toBe(
      "expected ']' to close the 'in' list, found the end of the expression",
    )
  })

  it('reports a malformed is-null', () => {
    expect(failure('first_name is 3')).toMatchObject({
      message: "expected 'null' after 'is', found '3'",
      offset: 14,
    })
  })

  it('reports a field used without a comparison', () => {
    expect(failure('email').message).toBe(
      'expected a comparison after this field, found the end of the expression',
    )
    expect(failure('open_count and subscribed').offset).toBe(11)
  })

  it('reports a reserved word used as a predicate', () => {
    expect(failure('true and subscribed')).toMatchObject({
      message: "'true' is a reserved word and cannot start a predicate",
      offset: 0,
    })
  })

  it('reports an unknown character', () => {
    expect(failure('email @ 1')).toMatchObject({ message: "unexpected character '@'", offset: 6 })
  })

  it('reports an unknown duration unit', () => {
    expect(failure('last_open_at > 30y')).toMatchObject({
      message: "unknown duration unit 'y' (use s, m, h, d or w)",
      offset: 17,
    })
  })

  it('reports a bad custom field reference', () => {
    expect(failure('data = 1').message).toBe(
      '\'data\' needs a field, e.g. data.plan or data["seat count"]',
    )
    expect(failure('data.3 = 1').message).toBe(
      "expected a custom field name after 'data.', found '3'",
    )
    expect(failure('data[plan] = 1').message).toBe(
      "expected a quoted custom field name, found 'plan'",
    )
    expect(failure('data["a\\"b"] = 1').message).toBe('custom field names cannot contain " or \\')
    expect(failure('data[""] = 1').message).toBe('custom field name is empty')
  })
})
