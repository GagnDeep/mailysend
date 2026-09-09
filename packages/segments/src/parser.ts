import type {
  CompareOp,
  Duration,
  DurationUnit,
  EngagementEvent,
  Expr,
  FieldRef,
  Literal,
  Sugar,
} from './ast.ts'
import { DURATION_MS, SegmentError } from './ast.ts'
import { COLUMNS, columnNames, isColumn } from './fields.ts'

/**
 * Tokenizer and Pratt parser for the segment DSL.
 *
 * Two properties are load-bearing and worth stating up front:
 *
 *   1. An identifier is resolved against the column registry *here*, at parse
 *      time. An unknown name never becomes an AST node, so the compiler cannot
 *      be handed a field it would have to trust.
 *   2. Every token carries its offset, and every error carries one too. The
 *      segment builder puts a caret under the offending character; an error
 *      without a position turns a typo into a guessing game.
 */

type TokenType = 'ident' | 'string' | 'number' | 'duration' | 'op' | 'punct' | 'eof'

interface Token {
  type: TokenType
  /** The lexeme for idents/ops/punct; the decoded body for strings. */
  text: string
  offset: number
  number?: number
  duration?: Duration
}

const IDENT_START = /[A-Za-z_]/
const IDENT_PART = /[A-Za-z0-9_]/
const DIGIT = /[0-9]/

const OPERATORS = ['>=', '<=', '!=', '<>', '==', '=', '>', '<']

/** Reserved words. They are matched case-insensitively; field names are not. */
const KEYWORDS = new Set([
  'and',
  'or',
  'not',
  'in',
  'is',
  'null',
  'true',
  'false',
  'contains',
  'starts_with',
  'ends_with',
])

export const tokenize = (input: string): Token[] => {
  const tokens: Token[] = []
  let i = 0

  while (i < input.length) {
    const ch = input[i]!

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }

    if (ch === '"' || ch === "'") {
      const start = i
      const quote = ch
      let value = ''
      i++
      let closed = false
      while (i < input.length) {
        const c = input[i]!
        if (c === '\\' && i + 1 < input.length) {
          value += input[i + 1]
          i += 2
          continue
        }
        if (c === quote) {
          i++
          closed = true
          break
        }
        value += c
        i++
      }
      if (!closed) throw new SegmentError('unterminated string literal', start)
      tokens.push({ type: 'string', text: value, offset: start })
      continue
    }

    if (DIGIT.test(ch)) {
      const start = i
      while (i < input.length && DIGIT.test(input[i]!)) i++
      if (input[i] === '.' && DIGIT.test(input[i + 1] ?? '')) {
        i++
        while (i < input.length && DIGIT.test(input[i]!)) i++
      }
      const digits = input.slice(start, i)
      // A unit suffix makes it a duration. Anything else glued to a number is a
      // typo, not an identifier, so it is rejected rather than split silently.
      const suffix = input[i]
      if (suffix && IDENT_PART.test(suffix)) {
        const unitStart = i
        while (i < input.length && IDENT_PART.test(input[i]!)) i++
        const unit = input.slice(unitStart, i)
        if (!isDurationUnit(unit)) {
          throw new SegmentError(`unknown duration unit '${unit}' (use s, m, h, d or w)`, unitStart)
        }
        const count = Number.parseFloat(digits)
        tokens.push({
          type: 'duration',
          text: digits + unit,
          offset: start,
          duration: { count, unit, ms: count * DURATION_MS[unit] },
        })
        continue
      }
      tokens.push({
        type: 'number',
        text: digits,
        offset: start,
        number: Number.parseFloat(digits),
      })
      continue
    }

    if (IDENT_START.test(ch)) {
      const start = i
      while (i < input.length && IDENT_PART.test(input[i]!)) i++
      tokens.push({ type: 'ident', text: input.slice(start, i), offset: start })
      continue
    }

    const op = OPERATORS.find((o) => input.startsWith(o, i))
    if (op) {
      tokens.push({ type: 'op', text: op, offset: i })
      i += op.length
      continue
    }

    if ('()[],.'.includes(ch)) {
      tokens.push({ type: 'punct', text: ch, offset: i })
      i++
      continue
    }

    throw new SegmentError(`unexpected character '${ch}'`, i)
  }

  tokens.push({ type: 'eof', text: '', offset: input.length })
  return tokens
}

const isDurationUnit = (unit: string): unit is DurationUnit =>
  unit === 's' || unit === 'm' || unit === 'h' || unit === 'd' || unit === 'w'

/**
 * `opened_last_30d`, `clicked_last_7d`, `sent_last_90d`, `bounced_last_4w`.
 * The count and unit are free, so the builder does not need a new keyword every
 * time somebody wants a fortnight.
 */
const WINDOWED_SUGAR = /^(opened|clicked|sent|bounced)_last_(\d+)([smhdw])$/

const parseSugar = (name: string): Sugar | null => {
  const windowed = WINDOWED_SUGAR.exec(name)
  if (windowed) {
    const event = windowed[1] as EngagementEvent
    const count = Number.parseInt(windowed[2]!, 10)
    const unit = windowed[3] as DurationUnit
    return { kind: 'recent', event, window: { count, unit, ms: count * DURATION_MS[unit] } }
  }
  if (name === 'never_opened') return { kind: 'never', event: 'opened' }
  if (name === 'never_clicked') return { kind: 'never', event: 'clicked' }
  if (name === 'subscribed') return { kind: 'subscribed' }
  if (name === 'bounced') return { kind: 'bounced' }
  return null
}

const COMPARISON_WORDS: Record<string, CompareOp> = {
  contains: 'contains',
  starts_with: 'starts_with',
  ends_with: 'ends_with',
}

const NORMALISED_OPS: Record<string, CompareOp> = {
  '=': '=',
  '==': '=',
  '!=': '!=',
  '<>': '!=',
  '>': '>',
  '>=': '>=',
  '<': '<',
  '<=': '<=',
}

/** Binding powers. `or` binds loosest, then `and`, then the `not` prefix. */
const BP_OR = 1
const BP_AND = 2
const BP_NOT = 3

class Parser {
  #tokens: Token[]
  #pos = 0

  constructor(tokens: Token[]) {
    this.#tokens = tokens
  }

  #peek(ahead = 0): Token {
    return this.#tokens[Math.min(this.#pos + ahead, this.#tokens.length - 1)]!
  }

  #next(): Token {
    const t = this.#peek()
    if (t.type !== 'eof') this.#pos++
    return t
  }

  #isWord(t: Token, word: string): boolean {
    return t.type === 'ident' && t.text.toLowerCase() === word
  }

  #expectPunct(ch: string, what: string): Token {
    const t = this.#peek()
    if (t.type !== 'punct' || t.text !== ch) {
      throw new SegmentError(`expected '${ch}' ${what}, found ${describeToken(t)}`, t.offset)
    }
    return this.#next()
  }

  parse(): Expr {
    if (this.#peek().type === 'eof') throw new SegmentError('expression is empty', 0)
    const expr = this.expression(0)
    const trailing = this.#peek()
    if (trailing.type !== 'eof') {
      throw new SegmentError(
        `unexpected ${describeToken(trailing)} after a complete expression`,
        trailing.offset,
      )
    }
    return expr
  }

  expression(minBp: number): Expr {
    let left = this.unary()
    for (;;) {
      const t = this.#peek()
      const bp = this.#isWord(t, 'and') ? BP_AND : this.#isWord(t, 'or') ? BP_OR : 0
      if (bp === 0 || bp < minBp) return left
      const kind = this.#isWord(t, 'and') ? 'and' : 'or'
      this.#next()
      // Left-associative: recurse at bp + 1 so `a and b and c` nests leftwards.
      const right = this.expression(bp + 1)
      left = { type: kind, left, right }
    }
  }

  unary(): Expr {
    const t = this.#peek()
    if (this.#isWord(t, 'not')) {
      this.#next()
      return { type: 'not', operand: this.expression(BP_NOT) }
    }
    return this.primary()
  }

  primary(): Expr {
    const t = this.#peek()

    if (t.type === 'punct' && t.text === '(') {
      this.#next()
      const inner = this.expression(0)
      this.#expectPunct(')', 'to close the group')
      return inner
    }

    if (t.type !== 'ident') {
      throw new SegmentError(`expected a field or predicate, found ${describeToken(t)}`, t.offset)
    }

    const lower = t.text.toLowerCase()
    if (KEYWORDS.has(lower) && lower !== 'not') {
      throw new SegmentError(
        `'${t.text}' is a reserved word and cannot start a predicate`,
        t.offset,
      )
    }

    // A column always wins over sugar, so `unsubscribed` reads as the column and
    // gets the bare-boolean treatment below rather than a second meaning.
    if (!isColumn(lower)) {
      const sugar = parseSugar(lower)
      if (sugar) {
        this.#next()
        return { type: 'sugar', source: lower, sugar, offset: t.offset }
      }
    }

    const field = this.fieldRef()
    return this.predicateTail(field, t.offset)
  }

  fieldRef(): FieldRef {
    const t = this.#next()
    const name = t.text.toLowerCase()

    if (name === 'data') {
      const path: string[] = []
      for (;;) {
        const nxt = this.#peek()
        if (nxt.type === 'punct' && nxt.text === '.') {
          this.#next()
          const key = this.#peek()
          if (key.type !== 'ident') {
            throw new SegmentError(
              `expected a custom field name after 'data.', found ${describeToken(key)}`,
              key.offset,
            )
          }
          this.#next()
          path.push(checkKey(key.text, key.offset))
          continue
        }
        if (nxt.type === 'punct' && nxt.text === '[') {
          this.#next()
          const key = this.#peek()
          if (key.type !== 'string') {
            throw new SegmentError(
              `expected a quoted custom field name, found ${describeToken(key)}`,
              key.offset,
            )
          }
          this.#next()
          path.push(checkKey(key.text, key.offset))
          this.#expectPunct(']', 'to close the custom field name')
          continue
        }
        break
      }
      if (path.length === 0) {
        throw new SegmentError(
          '\'data\' needs a field, e.g. data.plan or data["seat count"]',
          t.offset,
        )
      }
      return { kind: 'data', path }
    }

    if (!isColumn(name)) {
      throw new SegmentError(`unknown field '${t.text}'${suggest(name)}`, t.offset)
    }
    return { kind: 'column', name }
  }

  predicateTail(field: FieldRef, offset: number): Expr {
    const t = this.#peek()

    if (t.type === 'op') {
      this.#next()
      const op = NORMALISED_OPS[t.text]!
      return { type: 'compare', field, op, value: this.literal(), offset }
    }

    if (t.type === 'ident') {
      const word = t.text.toLowerCase()
      const wordOp = COMPARISON_WORDS[word]
      if (wordOp) {
        this.#next()
        return { type: 'compare', field, op: wordOp, value: this.literal(), offset }
      }
      if (word === 'in') {
        this.#next()
        return { type: 'in', field, values: this.literalList(), offset }
      }
      if (word === 'is') {
        this.#next()
        let negated = false
        if (this.#isWord(this.#peek(), 'not')) {
          this.#next()
          negated = true
        }
        const nullTok = this.#peek()
        if (!this.#isWord(nullTok, 'null')) {
          throw new SegmentError(
            `expected 'null' after 'is', found ${describeToken(nullTok)}`,
            nullTok.offset,
          )
        }
        this.#next()
        return { type: 'isNull', field, negated, offset }
      }
    }

    // A bare boolean column is a predicate on its own: `unsubscribed` means
    // `unsubscribed = true`. Anything else without an operator is a mistake.
    if (field.kind === 'column' && COLUMNS[field.name].type === 'boolean') {
      return { type: 'compare', field, op: '=', value: { kind: 'boolean', value: true }, offset }
    }

    throw new SegmentError(
      `expected a comparison after this field, found ${describeToken(t)}`,
      t.offset,
    )
  }

  literal(): Literal {
    const t = this.#next()
    switch (t.type) {
      case 'string':
        return { kind: 'string', value: t.text }
      case 'number':
        return { kind: 'number', value: t.number! }
      case 'duration':
        return { kind: 'duration', duration: t.duration! }
      case 'ident': {
        const word = t.text.toLowerCase()
        if (word === 'true') return { kind: 'boolean', value: true }
        if (word === 'false') return { kind: 'boolean', value: false }
        if (word === 'null') return { kind: 'null' }
        throw new SegmentError(
          `expected a value, found '${t.text}' — quote it if you meant a string`,
          t.offset,
        )
      }
      default:
        throw new SegmentError(`expected a value, found ${describeToken(t)}`, t.offset)
    }
  }

  literalList(): Literal[] {
    this.#expectPunct('[', "to start the 'in' list")
    const values: Literal[] = []
    if (this.#peek().type === 'punct' && this.#peek().text === ']') {
      throw new SegmentError("'in' needs at least one value", this.#peek().offset)
    }
    for (;;) {
      values.push(this.literal())
      const nxt = this.#peek()
      if (nxt.type === 'punct' && nxt.text === ',') {
        this.#next()
        continue
      }
      break
    }
    this.#expectPunct(']', "to close the 'in' list")
    return values
  }
}

const checkKey = (key: string, offset: number): string => {
  // The key becomes a JSON path (`$."plan"`) bound as a parameter. A double
  // quote or backslash would need path-level escaping that SQLite's json1 does
  // not define, so those keys are refused outright rather than mangled.
  if (key.length === 0) throw new SegmentError('custom field name is empty', offset)
  if (/["\\]/.test(key)) throw new SegmentError('custom field names cannot contain " or \\', offset)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control chars in a JSON path are the thing being rejected
  if (/[\u0000-\u001f]/.test(key))
    throw new SegmentError('custom field name contains a control character', offset)
  return key
}

const describeToken = (t: Token): string => {
  switch (t.type) {
    case 'eof':
      return 'the end of the expression'
    case 'string':
      return `the string '${t.text}'`
    case 'number':
    case 'duration':
      return `'${t.text}'`
    default:
      return `'${t.text}'`
  }
}

/** Cheap edit-distance-1 suggestion. Wrong field names are almost always typos. */
const suggest = (name: string): string => {
  const near = columnNames().find((c) => editDistanceAtMostTwo(c, name))
  return near ? ` — did you mean '${near}'?` : ''
}

const editDistanceAtMostTwo = (a: string, b: string): boolean => {
  if (Math.abs(a.length - b.length) > 2) return false
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row.push(
        Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)),
      )
    }
    prev = row
  }
  return prev[b.length]! <= 2
}

export const parse = (input: string): Expr => new Parser(tokenize(input)).parse()
