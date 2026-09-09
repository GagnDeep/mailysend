import Handlebars from 'handlebars'
import { escapeHtml, escapeUrlAttr, isSafeUrl } from './html.ts'
import type { RenderOptions, RenderWarning } from './types.ts'
import { warn } from './types.ts'

/**
 * Handlebars, interpreted rather than compiled.
 *
 * `Handlebars.compile()` generates JavaScript source and hands it to
 * `new Function`. That is a non-starter here: Workers refuse dynamic code
 * evaluation outright, and even where it is allowed, compiling a template
 * fetched from the database is a remote-code-execution primitive wearing a
 * template engine's clothes. So we use handlebars only for `parse()` — a plain
 * recursive-descent parser with no eval in it — and walk the resulting AST
 * ourselves.
 *
 * The cost is that we support a deliberately small language: the four built-in
 * block helpers plus the fixed helper table below. The benefit is that the set
 * of things a template *can* do is enumerable on one screen, which is the only
 * form of sandboxing that survives contact with untrusted authors.
 *
 * Note also that we ignore the escaped/unescaped distinction: `{{{x}}}` is
 * escaped exactly like `{{x}}`. Raw output exists so that a template can splice
 * markup built elsewhere, but here "elsewhere" is contact data — a first name,
 * a company name, a free-text field from a signup form. Honouring triple-stash
 * would mean any contact who typed `<script>` into a form field gets it
 * rendered in every recipient's client that runs script, and stored HTML
 * injection in an email body is also a phishing primitive: an attacker-supplied
 * `<a>` inside a legitimately-DKIM-signed message from a legitimate brand. A
 * warning is emitted so authors find out why their raw block is escaped.
 */

type AstProgram = ReturnType<typeof Handlebars.parse>
type AstExpression = { type: string } & Record<string, any>

/** Marks a helper result that is already markup and must not be re-escaped. */
interface SafeValue {
  readonly __safe: string
}

const safe = (value: string): SafeValue => ({ __safe: value })
const isSafe = (value: unknown): value is SafeValue =>
  typeof value === 'object' && value !== null && typeof (value as SafeValue).__safe === 'string'

/**
 * Blocked at lookup time rather than by freezing objects, because the data we
 * render comes straight from `JSON.parse` of a contact row and a key called
 * `constructor` in there must resolve to nothing, not to `Object`.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

interface Frame {
  context: unknown
  parent: Frame | null
  data: Record<string, unknown>
  blockParams: Record<string, unknown>
}

interface EvalContext {
  root: unknown
  warnings: RenderWarning[]
  options: RenderOptions
  /** Suppressed for subjects and text parts, where entities would be visible. */
  escape: boolean
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

type Helper = (args: unknown[], hash: Record<string, unknown>, ctx: EvalContext) => unknown

const str = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (isSafe(value)) return value.__safe
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value) ?? ''
  return String(value)
}

const truthy = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.length > 0
  if (value === null || value === undefined || value === false) return false
  if (value === 0 || Number.isNaN(value as number)) return false
  if (value === '') return false
  return true
}

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') return new Date(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

const compare = (a: unknown, b: unknown, cmp: (x: number, y: number) => boolean): boolean => {
  const na = typeof a === 'number' ? a : Number(a)
  const nb = typeof b === 'number' ? b : Number(b)
  if (Number.isNaN(na) || Number.isNaN(nb))
    return cmp(String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0, 0)
  return cmp(na - nb, 0)
}

const HELPERS: Record<string, Helper> = {
  upper: (args) => str(args[0]).toUpperCase(),
  lower: (args) => str(args[0]).toLowerCase(),
  capitalize: (args) => {
    const value = str(args[0])
    return value === '' ? '' : value[0]!.toUpperCase() + value.slice(1)
  },
  /** Empty string counts as missing — a blank merge field is the common case. */
  default: (args) => (truthy(args[0]) ? args[0] : (args[1] ?? '')),
  truncate: (args) => {
    const value = str(args[0])
    const limit = typeof args[1] === 'number' ? args[1] : 80
    const suffix = typeof args[2] === 'string' ? args[2] : '…'
    if (value.length <= limit) return value
    const cut = value.slice(0, Math.max(0, limit - suffix.length))
    const lastSpace = cut.lastIndexOf(' ')
    return `${(lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}${suffix}`
  },
  /**
   * Defaults to UTC. A Worker's clock is always UTC while a self-hosted Node
   * box is whatever the operator set, and "the same broadcast rendered a
   * different date depending on which runtime picked up the job" is a bug that
   * only shows up near midnight, in production.
   */
  formatDate: (args, hash, ctx) => {
    const date = toDate(args[0] ?? ctx.options.now)
    if (date === null) return ''
    const style = typeof args[1] === 'string' ? args[1] : 'medium'
    if (style === 'iso') return date.toISOString()
    const timeZone = typeof hash.tz === 'string' ? hash.tz : 'UTC'
    const locale = ctx.options.locale ?? 'en-US'
    const opts: Intl.DateTimeFormatOptions = { timeZone }
    if (style === 'time') opts.timeStyle = 'short'
    else if (style === 'datetime') {
      opts.dateStyle = 'medium'
      opts.timeStyle = 'short'
    } else
      opts.dateStyle = style === 'short' || style === 'long' || style === 'full' ? style : 'medium'
    try {
      return new Intl.DateTimeFormat(locale, opts).format(date)
    } catch {
      return date.toISOString()
    }
  },
  formatNumber: (args, hash, ctx) => {
    const value = typeof args[0] === 'number' ? args[0] : Number(str(args[0]))
    if (!Number.isFinite(value)) return ''
    const opts: Intl.NumberFormatOptions = {}
    const style =
      typeof hash.style === 'string'
        ? hash.style
        : typeof args[1] === 'string'
          ? args[1]
          : undefined
    if (style === 'currency') {
      opts.style = 'currency'
      opts.currency = typeof hash.currency === 'string' ? hash.currency : 'USD'
    } else if (style === 'percent') opts.style = 'percent'
    if (typeof hash.minimumFractionDigits === 'number')
      opts.minimumFractionDigits = hash.minimumFractionDigits
    if (typeof hash.maximumFractionDigits === 'number')
      opts.maximumFractionDigits = hash.maximumFractionDigits
    try {
      return new Intl.NumberFormat(ctx.options.locale ?? 'en-US', opts).format(value)
    } catch {
      return String(value)
    }
  },
  /** Returns the word only, so the author controls where the count goes. */
  pluralize: (args) => {
    const count = typeof args[0] === 'number' ? args[0] : Number(str(args[0]))
    const singular = str(args[1])
    const plural = args[2] === undefined ? `${singular}s` : str(args[2])
    return Math.abs(count) === 1 ? singular : plural
  },
  /**
   * The one helper that emits markup. `target=_blank` plus `rel=noopener` is
   * what keeps a click from handing the opener window to the destination, and
   * `data-ms-no-track` is the opt-out that `injectTracking` honours — an
   * unsubscribe or a preferences link must not be rewritten through the click
   * tracker, or unsubscribing costs a redirect that ad blockers eat.
   */
  link: (args, hash, ctx) => {
    const href = str(args[0])
    if (!isSafeUrl(href)) {
      ctx.warnings.push(warn('unsafe_url', 'Dropped a link with an unsupported url scheme.', href))
      return ''
    }
    const label = args[1] === undefined ? href : str(args[1])
    const attrs = [`href="${escapeUrlAttr(href)}"`, 'target="_blank"', 'rel="noopener noreferrer"']
    if (hash.track === false) attrs.push('data-ms-no-track')
    if (typeof hash.class === 'string') attrs.push(`class="${escapeHtml(hash.class)}"`)
    if (typeof hash.style === 'string') attrs.push(`style="${escapeHtml(hash.style)}"`)
    return safe(`<a ${attrs.join(' ')}>${escapeHtml(label)}</a>`)
  },

  eq: (args) => args[0] === args[1] || str(args[0]) === str(args[1]),
  ne: (args) => !(args[0] === args[1] || str(args[0]) === str(args[1])),
  gt: (args) => compare(args[0], args[1], (d) => d > 0),
  gte: (args) => compare(args[0], args[1], (d) => d >= 0),
  lt: (args) => compare(args[0], args[1], (d) => d < 0),
  lte: (args) => compare(args[0], args[1], (d) => d <= 0),
  and: (args) => args.every(truthy),
  or: (args) => args.some(truthy),
  not: (args) => !truthy(args[0]),
}

const BLOCK_HELPERS = new Set(['if', 'unless', 'each', 'with'])

/** Shared with the AST engine so both surfaces stringify and test truth alike. */
export const stringify = str
export const isTruthy = truthy

/**
 * Entry point for the AST engine's filter chain. Same table, same output, so
 * `{{formatDate x "short"}}` and `<Text>{date | formatDate:'short'}</Text>`
 * cannot drift apart.
 */
export const applyValueHelper = (
  name: string,
  args: unknown[],
  options: RenderOptions,
  warnings: RenderWarning[],
): unknown => {
  const helper = HELPERS[name]
  if (helper === undefined) {
    warnings.push(warn('unknown_helper', `Unknown filter \`${name}\`.`, name))
    return args[0]
  }
  return helper(args, {}, { root: {}, warnings, options, escape: true })
}

export const HELPER_NAMES: readonly string[] = [...Object.keys(HELPERS), ...BLOCK_HELPERS]

// ---------------------------------------------------------------------------
// Parse cache
// ---------------------------------------------------------------------------

/**
 * A broadcast renders one template body once per recipient. Parsing is by far
 * the most expensive part of that loop, and the body is identical every time,
 * so a small keyed cache turns an O(recipients) parse cost into O(1). Bounded
 * because a Worker isolate is shared across workspaces and an unbounded map
 * keyed by template source is a memory leak with a customer-controlled key.
 */
const PARSE_CACHE = new Map<string, AstProgram>()
const PARSE_CACHE_MAX = 64

export const parseTemplate = (source: string): AstProgram => {
  const cached = PARSE_CACHE.get(source)
  if (cached !== undefined) return cached
  const ast = Handlebars.parse(source)
  if (PARSE_CACHE.size >= PARSE_CACHE_MAX)
    PARSE_CACHE.delete(PARSE_CACHE.keys().next().value as string)
  PARSE_CACHE.set(source, ast)
  return ast
}

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------

const childFrame = (parent: Frame, context: unknown, data?: Record<string, unknown>): Frame => ({
  context,
  parent,
  data: { ...parent.data, ...data },
  blockParams: { ...parent.blockParams },
})

const property = (target: unknown, key: string | number): unknown => {
  if (target === null || target === undefined) return undefined
  if (typeof key === 'string' && FORBIDDEN_KEYS.has(key)) return undefined
  if (typeof target !== 'object' && typeof target !== 'string') return undefined
  return (target as Record<string | number, unknown>)[key]
}

const lookupPath = (path: AstExpression, frame: Frame, ctx: EvalContext): unknown => {
  const parts = (path.parts ?? []) as string[]

  if (path.data === true) {
    const key = parts[0]
    if (key === undefined) return frame.data
    if (key === 'root') return dig(ctx.root, parts.slice(1))
    return dig(frame.data[key], parts.slice(1))
  }

  let scope: Frame | null = frame
  for (let i = 0; i < (path.depth as number); i++) scope = scope?.parent ?? null
  if (scope === null) return undefined
  if (parts.length === 0) return scope.context

  const head = parts[0] as string
  if (path.depth === 0 && Object.hasOwn(scope.blockParams, head)) {
    return dig(scope.blockParams[head], parts.slice(1))
  }
  // `this.x` pins the lookup to the current context; a bare `x` may also fall
  // back to the root, which is what makes `{{brand_name}}` work inside an
  // `{{#each}}` without the author threading it through.
  const local = dig(scope.context, parts)
  if (local !== undefined || (path.original as string).startsWith('this')) return local
  return dig(ctx.root, parts)
}

const dig = (target: unknown, parts: readonly string[]): unknown => {
  let current = target
  for (const part of parts) {
    current = property(current, /^\d+$/.test(part) ? Number(part) : part)
    if (current === undefined) return undefined
  }
  return current
}

const evaluate = (node: AstExpression, frame: Frame, ctx: EvalContext): unknown => {
  switch (node.type) {
    case 'StringLiteral':
    case 'NumberLiteral':
    case 'BooleanLiteral':
      return node.value
    case 'UndefinedLiteral':
      return undefined
    case 'NullLiteral':
      return null
    case 'SubExpression':
      return callHelper(node, frame, ctx)
    case 'PathExpression':
      return lookupPath(node, frame, ctx)
    default:
      ctx.warnings.push(warn('unsupported_syntax', `Unsupported expression \`${node.type}\`.`))
      return undefined
  }
}

const evalHash = (
  hash: AstExpression | undefined,
  frame: Frame,
  ctx: EvalContext,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const pair of (hash?.pairs ?? []) as AstExpression[])
    out[pair.key as string] = evaluate(pair.value, frame, ctx)
  return out
}

const callHelper = (node: AstExpression, frame: Frame, ctx: EvalContext): unknown => {
  const name = (node.path?.parts ?? [])[0] as string | undefined
  const helper = name === undefined ? undefined : HELPERS[name]
  if (helper === undefined) {
    ctx.warnings.push(
      warn('unknown_helper', `Unknown helper \`${name ?? '?'}\`; rendered as empty.`, name),
    )
    return undefined
  }
  const args = (node.params as AstExpression[]).map((p) => evaluate(p, frame, ctx))
  return helper(args, evalHash(node.hash, frame, ctx), ctx)
}

const emit = (value: unknown, ctx: EvalContext): string => {
  if (isSafe(value)) return value.__safe
  const text = str(value)
  return ctx.escape ? escapeHtml(text) : text
}

const renderProgram = (program: AstProgram | undefined, frame: Frame, ctx: EvalContext): string => {
  if (program === undefined) return ''
  let out = ''
  for (const node of program.body) out += renderNode(node as AstExpression, frame, ctx)
  return out
}

const renderEach = (node: AstExpression, frame: Frame, ctx: EvalContext): string => {
  const subject = evaluate((node.params as AstExpression[])[0] as AstExpression, frame, ctx)
  const entries: [string, unknown][] = Array.isArray(subject)
    ? subject.map((v, i) => [String(i), v])
    : typeof subject === 'object' && subject !== null
      ? Object.entries(subject as Record<string, unknown>)
      : []
  if (entries.length === 0) return renderProgram(node.inverse, frame, ctx)

  const [itemName, indexName] = (node.program.blockParams ?? []) as (string | undefined)[]
  let out = ''
  for (const [index, [key, value]] of entries.entries()) {
    const scope = childFrame(frame, value, {
      index,
      key,
      first: index === 0,
      last: index === entries.length - 1,
    })
    if (itemName !== undefined) scope.blockParams[itemName] = value
    if (indexName !== undefined) scope.blockParams[indexName] = Array.isArray(subject) ? index : key
    out += renderProgram(node.program, scope, ctx)
  }
  return out
}

const renderBlock = (node: AstExpression, frame: Frame, ctx: EvalContext): string => {
  const name = (node.path.parts ?? [])[0] as string | undefined
  const params = node.params as AstExpression[]

  switch (name) {
    case 'if':
    case 'unless': {
      const value = truthy(evaluate(params[0] as AstExpression, frame, ctx))
      const take = name === 'if' ? value : !value
      return renderProgram(take ? node.program : node.inverse, frame, ctx)
    }
    case 'each':
      return renderEach(node, frame, ctx)
    case 'with': {
      const value = evaluate(params[0] as AstExpression, frame, ctx)
      if (!truthy(value)) return renderProgram(node.inverse, frame, ctx)
      const scope = childFrame(frame, value)
      const [alias] = (node.program.blockParams ?? []) as (string | undefined)[]
      if (alias !== undefined) scope.blockParams[alias] = value
      return renderProgram(node.program, scope, ctx)
    }
    default:
      ctx.warnings.push(
        warn('unknown_helper', `\`{{#${name ?? '?'}}}\` is not an allowed block helper.`, name),
      )
      return ''
  }
}

const renderNode = (node: AstExpression, frame: Frame, ctx: EvalContext): string => {
  switch (node.type) {
    case 'ContentStatement':
      return node.value as string
    case 'CommentStatement':
      return ''
    case 'MustacheStatement': {
      if (node.escaped === false) {
        ctx.warnings.push(
          warn(
            'raw_output_escaped',
            'Triple-stash output is escaped: template data may not emit markup.',
            node.path?.original as string,
          ),
        )
      }
      const isHelperCall =
        node.path?.type === 'PathExpression' &&
        (node.params as AstExpression[]).length === 0 &&
        (node.hash?.pairs?.length ?? 0) === 0
      if (isHelperCall) {
        const value = evaluate(node.path, frame, ctx)
        if (value === undefined) {
          ctx.warnings.push(
            warn(
              'missing_variable',
              `No value for \`${node.path.original}\`.`,
              node.path.original as string,
            ),
          )
        }
        return emit(value, ctx)
      }
      return emit(callHelper(node, frame, ctx), ctx)
    }
    case 'BlockStatement':
      return renderBlock(node, frame, ctx)
    case 'PartialStatement':
    case 'PartialBlockStatement':
      ctx.warnings.push(
        warn('unsupported_syntax', 'Partials are not available in email templates.'),
      )
      return ''
    case 'DecoratorBlock':
    case 'Decorator':
      ctx.warnings.push(
        warn('unsupported_syntax', 'Decorators are not available in email templates.'),
      )
      return ''
    default:
      return ''
  }
}

export interface HandlebarsOutput {
  output: string
  warnings: RenderWarning[]
}

export interface HandlebarsInput {
  data?: Record<string, unknown>
  options?: RenderOptions
  /** False for subjects and text parts, where entities would be visible. */
  escape?: boolean
}

export const renderHandlebars = (source: string, input: HandlebarsInput = {}): HandlebarsOutput => {
  const data = input.data ?? {}
  const ctx: EvalContext = {
    root: data,
    warnings: [],
    options: input.options ?? {},
    escape: input.escape !== false,
  }
  const frame: Frame = { context: data, parent: null, data: { root: data }, blockParams: {} }
  try {
    return { output: renderProgram(parseTemplate(source), frame, ctx), warnings: ctx.warnings }
  } catch (error) {
    // A parse error is an authoring mistake, not a data problem: fall back to
    // the source with the mustaches stripped so a broadcast still goes out
    // legible rather than showing raw template syntax to recipients.
    ctx.warnings.push(
      warn('unsupported_syntax', `Template did not parse: ${(error as Error).message}`),
    )
    return { output: source.replace(/\{\{[^}]*\}\}/g, ''), warnings: ctx.warnings }
  }
}

// ---------------------------------------------------------------------------
// Variable extraction
// ---------------------------------------------------------------------------

/**
 * Walks the parsed AST for the paths a template reads, so the dashboard can
 * build a preview form without the author listing them by hand.
 *
 * Loop bodies are reported against the array they iterate — `items[].name` —
 * because a form that offers `name` with no indication that it repeats is
 * worse than no form. Block params and `@`-data are skipped: they are bound by
 * the template, not supplied by the caller.
 */
export const extractHandlebarsVariables = (source: string): string[] => {
  const found = new Set<string>()
  let ast: AstProgram
  try {
    ast = parseTemplate(source)
  } catch {
    return []
  }

  const visit = (program: AstProgram | undefined, prefix: string, bound: Set<string>): void => {
    if (program === undefined) return
    for (const raw of program.body) {
      const node = raw as AstExpression
      if (node.type === 'MustacheStatement' || node.type === 'SubExpression') {
        collect(node, prefix, bound)
      } else if (node.type === 'BlockStatement') {
        const name = (node.path.parts ?? [])[0] as string | undefined
        const params = node.params as AstExpression[]
        for (const param of params) collect(param, prefix, bound)

        const inner = new Set(bound)
        for (const bp of (node.program?.blockParams ?? []) as string[]) inner.add(bp)

        if (name === 'each') {
          const path = pathOf(params[0], prefix, bound)
          visit(node.program, path === null ? prefix : `${path}[]`, inner)
        } else if (name === 'with') {
          const path = pathOf(params[0], prefix, bound)
          visit(node.program, path ?? prefix, inner)
        } else {
          visit(node.program, prefix, inner)
        }
        visit(node.inverse, prefix, bound)
      }
    }
  }

  const pathOf = (
    node: AstExpression | undefined,
    prefix: string,
    bound: Set<string>,
  ): string | null => {
    if (node === undefined || node.type !== 'PathExpression') return null
    const parts = (node.parts ?? []) as string[]
    if (node.data === true || (node.depth as number) > 0 || parts.length === 0) return null
    if (bound.has(parts[0] as string)) return null
    return prefix === '' ? parts.join('.') : `${prefix}.${parts.join('.')}`
  }

  const collect = (node: AstExpression, prefix: string, bound: Set<string>): void => {
    if (node.type === 'PathExpression') {
      const path = pathOf(node, prefix, bound)
      if (path !== null && !HELPERS[path]) found.add(path)
      return
    }
    if (node.type === 'MustacheStatement' || node.type === 'SubExpression') {
      const head = ((node.path?.parts ?? []) as string[])[0]
      const isHelper = head !== undefined && HELPERS[head] !== undefined
      if (!isHelper && node.path?.type === 'PathExpression') collect(node.path, prefix, bound)
      for (const param of (node.params ?? []) as AstExpression[]) collect(param, prefix, bound)
      for (const pair of (node.hash?.pairs ?? []) as AstExpression[])
        collect(pair.value, prefix, bound)
    }
  }

  visit(ast, '', new Set())
  return [...found].sort()
}
