import type { CompareOp, Expr, FieldRef, Literal } from './ast.ts'
import { expandSugar, SegmentError } from './ast.ts'
import type { ColumnName } from './fields.ts'
import { COLUMNS, DATA_COLUMN } from './fields.ts'
import { parse } from './parser.ts'

/**
 * Compiles an AST to a parameterised SQL WHERE fragment.
 *
 * The invariant, restated because it is the whole point of the file: the only
 * strings this module concatenates into SQL are (a) operator keywords chosen by
 * a `switch` over a closed union and (b) `ColumnDef.sql` values read out of the
 * hard-coded registry. Every value a user typed — including custom field names,
 * which travel as a `json_extract` path — leaves as a bound `?`.
 */

export interface CompileOptions {
  /** Resolves relative durations. Passed explicitly so the hourly sweep can recompile. */
  now?: Date
}

export interface CompiledSegment {
  /** A WHERE fragment. Always parenthesised, so it is safe to `AND` onto. */
  sql: string
  params: unknown[]
  /**
   * The contact fields the expression reads, sorted. This drives delta
   * recomputation: a contact write that touches none of these fields cannot
   * change membership, so the consumer skips the segment entirely. It must
   * therefore be complete — sugar is expanded before it is collected.
   */
  dependsOn: string[]
}

/** SQLite has no boolean type; the schema stores 0/1 integers. */
const boolParam = (value: boolean) => (value ? 1 : 0)

const SQL_OPS: Record<Exclude<CompareOp, 'contains' | 'starts_with' | 'ends_with'>, string> = {
  '=': '=',
  '!=': '!=',
  '>': '>',
  '>=': '>=',
  '<': '<',
  '<=': '<=',
}

interface Target {
  sql: string
  /**
   * Parameters the reference itself needs, re-bound every time it appears.
   * Only `json_extract(data, ?)` has any — and it has one, which is precisely
   * why a custom field name can never reach the query text.
   */
  refParams: unknown[]
  /** 'json' means the value's type is not known until runtime. */
  type: 'string' | 'number' | 'boolean' | 'timestamp' | 'json'
  nullable: boolean
  label: string
}

class Compiler {
  readonly params: unknown[] = []
  readonly deps = new Set<string>()
  #now: number

  constructor(now: Date) {
    this.#now = now.getTime()
  }

  #target(field: FieldRef): Target {
    if (field.kind === 'column') {
      const def = COLUMNS[field.name]
      this.deps.add(field.name)
      return {
        sql: def.sql,
        refParams: [],
        type: def.type,
        nullable: def.nullable,
        label: def.label,
      }
    }
    // The path is a parameter, not a literal, which is what makes an arbitrary
    // custom field name harmless. `$."a"."b"` is built from keys the parser has
    // already refused quotes and backslashes in.
    this.deps.add(`${DATA_COLUMN}.${field.path.join('.')}`)
    return {
      sql: `json_extract(${DATA_COLUMN}, ?)`,
      refParams: [`$${field.path.map((k) => `."${k}"`).join('')}`],
      type: 'json',
      nullable: true,
      label: field.path.join('.'),
    }
  }

  /** Emits one occurrence of the field, binding whatever that occurrence costs. */
  #ref(target: Target): string {
    for (const p of target.refParams) this.params.push(p)
    return target.sql
  }

  /**
   * Wraps a comparison so it evaluates to a real boolean rather than NULL.
   *
   * Without this, `not clicked_last_7d` excludes everyone who has never clicked
   * at all — `NOT (NULL > x)` is NULL, which SQL treats as false. That is the
   * exact opposite of what the marketer asked for, and it fails silently. The
   * guard is emitted only for nullable targets, so the common query stays clean.
   */
  #guarded(target: Target, emit: () => string): string {
    // Parameter order follows SQL text order, so the guard binds before the body.
    const guard = target.nullable ? `${this.#ref(target)} IS NOT NULL AND ` : ''
    return `(${guard}${emit()})`
  }

  compare(node: Extract<Expr, { type: 'compare' }>): string {
    const { op, value, offset } = node
    const target = this.#target(node.field)

    if (value.kind === 'null') {
      throw new SegmentError(`use 'is null' rather than '${op} null'`, offset, 'type')
    }

    if (op === 'contains' || op === 'starts_with' || op === 'ends_with') {
      if (target.type !== 'string' && target.type !== 'json') {
        throw new SegmentError(
          `'${op}' needs a text field, but ${target.label} is a ${target.type}`,
          offset,
          'type',
        )
      }
      if (value.kind !== 'string') {
        throw new SegmentError(`'${op}' needs a quoted string on the right`, offset, 'type')
      }
      const escaped = escapeLike(value.value)
      const pattern =
        op === 'contains' ? `%${escaped}%` : op === 'starts_with' ? `${escaped}%` : `%${escaped}`
      return this.#guarded(target, () => {
        const ref = this.#ref(target)
        this.params.push(pattern)
        return `${ref} LIKE ? ESCAPE '\\'`
      })
    }

    const bound = this.#coerce(target, value, offset)
    return this.#guarded(target, () => {
      const ref = this.#ref(target)
      this.params.push(bound)
      return `${ref} ${SQL_OPS[op]} ?`
    })
  }

  in(node: Extract<Expr, { type: 'in' }>): string {
    const target = this.#target(node.field)
    const bound = node.values.map((v) => {
      if (v.kind === 'null') {
        throw new SegmentError(
          "'in' lists cannot contain null — use 'is null'",
          node.offset,
          'type',
        )
      }
      return this.#coerce(target, v, node.offset)
    })
    return this.#guarded(target, () => {
      const ref = this.#ref(target)
      for (const b of bound) this.params.push(b)
      return `${ref} IN (${bound.map(() => '?').join(', ')})`
    })
  }

  isNull(node: Extract<Expr, { type: 'isNull' }>): string {
    const target = this.#target(node.field)
    // No guard: `IS NULL` is already total, and negating it is exact.
    return `(${this.#ref(target)} IS ${node.negated ? 'NOT ' : ''}NULL)`
  }

  /**
   * Turns a literal into a bound value of the right SQLite type, rejecting
   * comparisons that could only ever be false (`open_count = 'ten'`). A JSON
   * target accepts anything: its type is whatever the contact happens to store.
   */
  #coerce(target: Target, value: Literal, offset: number): unknown {
    if (value.kind === 'duration') {
      if (target.type !== 'timestamp' && target.type !== 'json') {
        throw new SegmentError(
          `a duration like ${value.duration.count}${value.duration.unit} only compares against a date field`,
          offset,
          'type',
        )
      }
      // `last_open_at > 30d` means "more recent than 30 days ago". Resolving it
      // here, not in the AST, is what keeps a cached parse valid across hours.
      return new Date(this.#now - value.duration.ms).toISOString()
    }

    // Callers reject `null` before they get here; `is null` is the only way to
    // ask about absence, and it does not go through coercion at all.
    if (value.kind === 'null')
      throw new SegmentError("use 'is null' to test for absence", offset, 'type')

    switch (target.type) {
      case 'json':
        return value.kind === 'boolean' ? boolParam(value.value) : value.value
      case 'boolean':
        if (value.kind !== 'boolean') {
          throw new SegmentError(
            `${target.label} is true or false, not ${describeLiteral(value)}`,
            offset,
            'type',
          )
        }
        return boolParam(value.value)
      case 'number':
        if (value.kind !== 'number') {
          throw new SegmentError(
            `${target.label} is a number, not ${describeLiteral(value)}`,
            offset,
            'type',
          )
        }
        return value.value
      case 'timestamp':
        if (value.kind !== 'string') {
          throw new SegmentError(
            `${target.label} is a date — compare it to a duration like 30d or an ISO string`,
            offset,
            'type',
          )
        }
        return value.value
      case 'string':
        if (value.kind !== 'string') {
          throw new SegmentError(
            `${target.label} is text, not ${describeLiteral(value)}`,
            offset,
            'type',
          )
        }
        return value.value
    }
  }

  expr(node: Expr): string {
    switch (node.type) {
      case 'and':
        return `(${this.expr(node.left)} AND ${this.expr(node.right)})`
      case 'or':
        return `(${this.expr(node.left)} OR ${this.expr(node.right)})`
      case 'not':
        return `(NOT ${this.expr(node.operand)})`
      case 'compare':
        return this.compare(node)
      case 'in':
        return this.in(node)
      case 'isNull':
        return this.isNull(node)
      case 'sugar':
        return this.expr(expandSugar(node))
    }
  }
}

/** LIKE has its own wildcards; a literal `%` from a user must not become one. */
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`)

const describeLiteral = (value: Literal): string => {
  switch (value.kind) {
    case 'string':
      return 'text'
    case 'number':
      return 'a number'
    case 'boolean':
      return 'true or false'
    case 'null':
      return 'null'
    case 'duration':
      return 'a duration'
  }
}

export const compile = (ast: Expr, options: CompileOptions = {}): CompiledSegment => {
  const compiler = new Compiler(options.now ?? new Date())
  const sql = compiler.expr(ast)
  return { sql, params: compiler.params, dependsOn: [...compiler.deps].sort() }
}

/** Parse and compile in one step. The path every caller outside tests takes. */
export const compileExpression = (source: string, options: CompileOptions = {}): CompiledSegment =>
  compile(parse(source), options)

export interface RelativeWindow {
  column: ColumnName
  /** How far back the threshold sits from `now`, in milliseconds. */
  ms: number
}

/**
 * The time-relative predicates in an expression.
 *
 * These are the ones that change membership with no write at all, and they are
 * what the boundary sweep needs in order to know which slice of the table to
 * re-check. Collected post-expansion so `opened_last_30d` is included.
 */
export const relativeWindows = (ast: Expr): RelativeWindow[] => {
  const found = new Map<string, RelativeWindow>()
  const walk = (node: Expr): void => {
    switch (node.type) {
      case 'and':
      case 'or':
        walk(node.left)
        walk(node.right)
        return
      case 'not':
        walk(node.operand)
        return
      case 'sugar':
        walk(expandSugar(node))
        return
      case 'compare':
        if (node.value.kind === 'duration' && node.field.kind === 'column') {
          const window = { column: node.field.name, ms: node.value.duration.ms }
          found.set(`${window.column}:${window.ms}`, window)
        }
        return
      default:
        return
    }
  }
  walk(ast)
  return [...found.values()]
}
