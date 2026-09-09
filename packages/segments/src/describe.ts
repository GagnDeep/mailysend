import type { CompareOp, Duration, EngagementEvent, Expr, FieldRef, Literal } from './ast.ts'
import { COLUMNS } from './fields.ts'
import { parse } from './parser.ts'

/**
 * Plain-English rendering, for the line under the expression box.
 *
 * This is a trust device, not decoration. A marketer who types
 * `not clicked_last_7d` and reads back "has not clicked in the last 7 days"
 * knows the NULL handling went their way; without it they find out from a
 * broadcast that reached 40 people instead of 40,000.
 *
 * Negation is pushed into the leaves rather than rendered as "not (…)",
 * because "has not opened in the last 30 days" is a sentence and
 * "not (opened in the last 30 days)" is a debug dump.
 */

const PLURAL: Record<Duration['unit'], [string, string]> = {
  s: ['second', 'seconds'],
  m: ['minute', 'minutes'],
  h: ['hour', 'hours'],
  d: ['day', 'days'],
  w: ['week', 'weeks'],
}

const humanDuration = (d: Duration): string => {
  const [one, many] = PLURAL[d.unit]
  return `${d.count} ${d.count === 1 ? one : many}`
}

const VERB: Record<EngagementEvent, [string, string]> = {
  opened: ['opened', 'has not opened'],
  clicked: ['clicked', 'has not clicked'],
  sent: ['received email', 'was not sent email'],
  bounced: ['bounced', 'has not bounced'],
}

const fieldLabel = (field: FieldRef): string =>
  field.kind === 'column' ? COLUMNS[field.name].label : field.path.join('.')

const literalText = (value: Literal): string => {
  switch (value.kind) {
    case 'string':
      return `"${value.value}"`
    case 'number':
      return String(value.value)
    case 'boolean':
      return value.value ? 'yes' : 'no'
    case 'null':
      return 'nothing'
    case 'duration':
      return `${humanDuration(value.duration)} ago`
  }
}

const COMPARISON_TEXT: Record<CompareOp, [string, string]> = {
  '=': ['is', 'is not'],
  '!=': ['is not', 'is'],
  '>': ['is more than', 'is at most'],
  '>=': ['is at least', 'is less than'],
  '<': ['is less than', 'is at least'],
  '<=': ['is at most', 'is more than'],
  contains: ['contains', 'does not contain'],
  starts_with: ['starts with', 'does not start with'],
  ends_with: ['ends with', 'does not end with'],
}

/** Dates read better as before/after than as more/less. */
const DATE_TEXT: Record<'>' | '>=' | '<' | '<=', [string, string]> = {
  '>': ['was after', 'was on or before'],
  '>=': ['was on or after', 'was before'],
  '<': ['was before', 'was on or after'],
  '<=': ['was on or before', 'was after'],
}

const describeCompare = (node: Extract<Expr, { type: 'compare' }>, negated: boolean): string => {
  const label = fieldLabel(node.field)
  const isDate = node.field.kind === 'column' && COLUMNS[node.field.name].type === 'timestamp'

  // A bare boolean column prints as a state, not as `unsubscribed is yes`.
  if (
    node.field.kind === 'column' &&
    COLUMNS[node.field.name].type === 'boolean' &&
    node.value.kind === 'boolean' &&
    node.op === '='
  ) {
    const asserted = node.value.value !== negated
    return asserted ? `is ${label}` : `is not ${label}`
  }

  if (isDate && (node.op === '>' || node.op === '>=' || node.op === '<' || node.op === '<=')) {
    const [yes, no] = DATE_TEXT[node.op]
    return `${label} ${negated ? no : yes} ${literalText(node.value)}`
  }

  const [yes, no] = COMPARISON_TEXT[node.op]
  return `${label} ${negated ? no : yes} ${literalText(node.value)}`
}

const describeSugar = (node: Extract<Expr, { type: 'sugar' }>, negated: boolean): string => {
  const s = node.sugar
  switch (s.kind) {
    case 'recent': {
      const [yes, no] = VERB[s.event]
      // `bounced_last_Nd` compiles to "ever bounced" — see expandSugar — so it
      // must not claim a window it does not actually enforce.
      if (s.event === 'bounced') return negated ? 'has never bounced' : 'has bounced'
      return `${negated ? no : yes} in the last ${humanDuration(s.window)}`
    }
    case 'never': {
      const verb = s.event === 'opened' ? 'opened' : 'clicked'
      return negated ? `has ${verb} at least once` : `has never ${verb}`
    }
    case 'subscribed':
      return negated ? 'is unsubscribed' : 'is subscribed'
    case 'bounced':
      return negated ? 'has never bounced' : 'has bounced'
  }
}

const describeNode = (node: Expr, negated: boolean): string => {
  switch (node.type) {
    case 'not':
      return describeNode(node.operand, !negated)
    case 'and':
    case 'or': {
      // De Morgan: negating an `and` makes it an `or`, and vice versa.
      const joiner = (node.type === 'and') !== negated ? ' and ' : ' or '
      const parts = [describeNode(node.left, negated), describeNode(node.right, negated)]
      return parts.join(joiner)
    }
    case 'compare':
      return describeCompare(node, negated)
    case 'in': {
      const values = node.values.map(literalText)
      const list =
        values.length === 1 ? values[0]! : `${values.slice(0, -1).join(', ')} or ${values.at(-1)}`
      return `${fieldLabel(node.field)} ${negated ? 'is not' : 'is'} ${list}`
    }
    case 'isNull': {
      const missing = node.negated === negated
      return `${fieldLabel(node.field)} ${missing ? 'is missing' : 'is set'}`
    }
    case 'sugar':
      return describeSugar(node, negated)
  }
}

/** `opened_last_30d and not clicked_last_7d` → "opened in the last 30 days and has not clicked in the last 7 days". */
export const describe = (input: Expr | string): string =>
  describeNode(typeof input === 'string' ? parse(input) : input, false)

const PRECEDENCE = { or: 1, and: 2, not: 3 } as const

const literalSource = (value: Literal): string => {
  switch (value.kind) {
    case 'string':
      return `'${value.value.replace(/(['\\])/g, '\\$1')}'`
    case 'number':
      return String(value.value)
    case 'boolean':
      return String(value.value)
    case 'null':
      return 'null'
    case 'duration':
      return `${value.duration.count}${value.duration.unit}`
  }
}

const fieldSource = (field: FieldRef): string => {
  if (field.kind === 'column') return field.name
  return `data${field.path.map((k) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? `.${k}` : `["${k}"]`)).join('')}`
}

const formatNode = (node: Expr, parentBp: number): string => {
  switch (node.type) {
    case 'and':
    case 'or': {
      const bp = PRECEDENCE[node.type]
      const text = `${formatNode(node.left, bp)} ${node.type} ${formatNode(node.right, bp + 1)}`
      return bp < parentBp ? `(${text})` : text
    }
    case 'not': {
      const text = `not ${formatNode(node.operand, PRECEDENCE.not)}`
      return PRECEDENCE.not < parentBp ? `(${text})` : text
    }
    case 'compare':
      return `${fieldSource(node.field)} ${node.op} ${literalSource(node.value)}`
    case 'in':
      return `${fieldSource(node.field)} in [${node.values.map(literalSource).join(', ')}]`
    case 'isNull':
      return `${fieldSource(node.field)} is ${node.negated ? 'not ' : ''}null`
    case 'sugar':
      return node.source
  }
}

/**
 * Canonical source for an AST: normalised spacing and only the parentheses
 * precedence actually requires. Re-parsing the output yields the same AST,
 * which is what makes it safe to store back over what the user typed.
 */
export const formatExpression = (input: Expr | string): string =>
  formatNode(typeof input === 'string' ? parse(input) : input, 0)
