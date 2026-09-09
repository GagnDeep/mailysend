import { z } from 'zod'
import { applyValueHelper, isTruthy, stringify } from './handlebars.ts'
import { escapeHtml, escapeUrlAttr, isSafeUrl } from './html.ts'
import type { RenderOptions, RenderWarning } from './types.ts'
import { warn } from './types.ts'

/**
 * The `jsx-ast` engine.
 *
 * `mailysend templates push` takes a React-Email-style `.tsx` file, runs it
 * through a real parser (in the CLI, on the developer's machine, where a
 * parser and a filesystem are fine) and lowers it to the data-only tree below.
 * The server never sees JSX and never evaluates anything: it walks a JSON
 * document whose every node is one of six shapes, whose expressions are
 * property access and nothing else, and whose output is escaped at every
 * interpolation site.
 *
 * That split is the whole design. A template body is customer-controlled data
 * that we store and later render inside a shared isolate on behalf of a
 * different customer's send. Anything that can evaluate an expression from
 * that body is a sandbox escape waiting to be found, so the expression
 * language has no calls, no operators outside a fixed comparison set, no
 * arithmetic, and no way to reach a prototype. The filter chain is the escape
 * valve for formatting, and it resolves against the same fixed helper table
 * the Handlebars engine uses.
 *
 * `compileJsxToAst` deliberately does not live here — it belongs to the CLI.
 * What lives here is the contract both sides agree on: the schema, and
 * `validateAst()`.
 */

export const AST_VERSION = 1

// ---------------------------------------------------------------------------
// Types (hand-written because the node union is recursive)
// ---------------------------------------------------------------------------

export type AstLiteral = string | number | boolean | null

/** Property access only. Numbers are array indexes; strings are keys. */
export interface AstPath {
  type: 'path'
  segments: (string | number)[]
}

export interface AstLiteralExpr {
  type: 'literal'
  value: AstLiteral
}

export type AstExpr = AstPath | AstLiteralExpr

export type FilterName =
  | 'upper'
  | 'lower'
  | 'capitalize'
  | 'default'
  | 'truncate'
  | 'formatDate'
  | 'formatNumber'
  | 'pluralize'

export interface AstFilter {
  name: FilterName
  args: AstLiteral[]
}

export type CompareOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'

export type AstCondition =
  | { type: 'truthy'; value: AstExpr }
  | { type: 'not'; condition: AstCondition }
  | { type: 'compare'; op: CompareOp; left: AstExpr; right: AstExpr }
  | { type: 'and'; conditions: AstCondition[] }
  | { type: 'or'; conditions: AstCondition[] }

export type AstValue =
  | { type: 'static'; value: string | number | boolean }
  | { type: 'dynamic'; expr: AstPath; filters?: AstFilter[] }

export interface AstText {
  type: 'text'
  value: string
}

export interface AstInterpolation {
  type: 'interpolation'
  expr: AstPath
  filters?: AstFilter[]
}

export interface AstElement {
  type: 'element'
  tag: string
  attrs?: Record<string, AstValue>
  children?: AstNode[]
}

export interface AstComponent {
  type: 'component'
  name: ComponentName
  props?: Record<string, AstValue>
  children?: AstNode[]
}

export interface AstConditional {
  type: 'conditional'
  test: AstCondition
  /** ESTree's names, so a CLI built on a real parser can pass them straight
   *  through, and so the node is never mistaken for a thenable. */
  consequent: AstNode[]
  alternate?: AstNode[]
}

export interface AstLoop {
  type: 'loop'
  source: AstPath
  /** Binding name for the current entry, referenced as `segments[0]`. */
  item: string
  /** Optional binding for the zero-based index. */
  index?: string
  body: AstNode[]
  /** Rendered when the source is empty or missing. */
  empty?: AstNode[]
}

export type AstNode =
  | AstText
  | AstInterpolation
  | AstElement
  | AstComponent
  | AstConditional
  | AstLoop

export interface TemplateAst {
  version: number
  nodes: AstNode[]
}

// ---------------------------------------------------------------------------
// Element and attribute policy
// ---------------------------------------------------------------------------

/**
 * Raw elements an author may drop to when a component is not enough. The
 * omissions are the point: no `script`, `style`, `iframe`, `object`, `embed`,
 * `form`, `input`, `link`, `meta` or `base`. Half of those are script vectors,
 * the other half are how a template body would exfiltrate a recipient's
 * interaction to somewhere we did not sign for.
 */
const ELEMENT_TAGS = new Set([
  'a',
  'abbr',
  'article',
  'aside',
  'b',
  'blockquote',
  'br',
  'caption',
  'center',
  'code',
  'col',
  'colgroup',
  'del',
  'div',
  'em',
  'figcaption',
  'figure',
  'font',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'img',
  'ins',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
])

const VOID_TAGS = new Set(['br', 'col', 'hr', 'img'])

const ATTRIBUTES = new Set([
  'align',
  'alt',
  'bgcolor',
  'border',
  'cellpadding',
  'cellspacing',
  'class',
  'colspan',
  'color',
  'dir',
  'height',
  'href',
  'id',
  'lang',
  'name',
  'rel',
  'role',
  'rowspan',
  'size',
  'src',
  'srcset',
  'style',
  'target',
  'title',
  'valign',
  'width',
])

const ATTRIBUTE_PREFIXES = ['data-', 'aria-']

/** Attributes whose value is a url and therefore needs a scheme check. */
const URL_ATTRIBUTES = new Set(['href', 'src', 'srcset', 'background'])

const isAllowedAttribute = (name: string): boolean =>
  ATTRIBUTES.has(name) || ATTRIBUTE_PREFIXES.some((prefix) => name.startsWith(prefix))

export const COMPONENTS = [
  'Html',
  'Head',
  'Body',
  'Container',
  'Section',
  'Row',
  'Column',
  'Text',
  'Heading',
  'Button',
  'Link',
  'Img',
  'Hr',
  'Preview',
  'CodeBlock',
] as const

export type ComponentName = (typeof COMPONENTS)[number]

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be a plain identifier')

const segment = z.union([
  z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_$][A-Za-z0-9_$-]*$/, 'must be a plain property name')
    .refine((s) => s !== '__proto__' && s !== 'constructor' && s !== 'prototype', {
      message: 'prototype access is not allowed',
    }),
  z.number().int().min(0).max(9999),
])

export const AstPathSchema = z.object({
  type: z.literal('path'),
  segments: z.array(segment).min(1).max(12),
})

const AstLiteralSchema = z.union([z.string().max(8192), z.number().finite(), z.boolean(), z.null()])

export const AstExprSchema = z.discriminatedUnion('type', [
  AstPathSchema,
  z.object({ type: z.literal('literal'), value: AstLiteralSchema }),
])

export const AstFilterSchema = z.object({
  name: z.enum([
    'upper',
    'lower',
    'capitalize',
    'default',
    'truncate',
    'formatDate',
    'formatNumber',
    'pluralize',
  ]),
  args: z.array(AstLiteralSchema).max(3).optional().default([]),
})

export const AstConditionSchema: z.ZodType<AstCondition> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('truthy'), value: AstExprSchema }),
    z.object({ type: z.literal('not'), condition: AstConditionSchema }),
    z.object({
      type: z.literal('compare'),
      op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']),
      left: AstExprSchema,
      right: AstExprSchema,
    }),
    z.object({ type: z.literal('and'), conditions: z.array(AstConditionSchema).min(1).max(8) }),
    z.object({ type: z.literal('or'), conditions: z.array(AstConditionSchema).min(1).max(8) }),
  ]),
)

export const AstValueSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('static'),
    value: z.union([z.string().max(8192), z.number().finite(), z.boolean()]),
  }),
  z.object({
    type: z.literal('dynamic'),
    expr: AstPathSchema,
    filters: z.array(AstFilterSchema).max(4).optional(),
  }),
])

const attrName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, 'must be a lowercase attribute name')
  .refine(isAllowedAttribute, { message: 'attribute is not allowed in email HTML' })

const children = z.array(z.lazy(() => AstNodeSchema)).max(2048)

const AstTextSchema = z.object({ type: z.literal('text'), value: z.string().max(65536) })

const AstInterpolationSchema = z.object({
  type: z.literal('interpolation'),
  expr: AstPathSchema,
  filters: z.array(AstFilterSchema).max(4).optional(),
})

const AstElementSchema = z.object({
  type: z.literal('element'),
  tag: z
    .string()
    .refine((t) => ELEMENT_TAGS.has(t), { message: 'element is not allowed in email HTML' }),
  attrs: z.record(attrName, AstValueSchema).optional(),
  children: children.optional(),
})

const AstComponentSchema = z.object({
  type: z.literal('component'),
  name: z.enum(COMPONENTS),
  props: z.record(z.string().min(1).max(64), AstValueSchema).optional(),
  children: children.optional(),
})

const AstConditionalSchema = z.object({
  type: z.literal('conditional'),
  test: AstConditionSchema,
  consequent: children,
  alternate: children.optional(),
})

const AstLoopSchema = z.object({
  type: z.literal('loop'),
  source: AstPathSchema,
  item: identifier,
  index: identifier.optional(),
  body: children,
  empty: children.optional(),
})

export const AstNodeSchema: z.ZodType<AstNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    AstTextSchema,
    AstInterpolationSchema,
    AstElementSchema,
    AstComponentSchema,
    AstConditionalSchema,
    AstLoopSchema,
  ]),
) as z.ZodType<AstNode>

export const TemplateAstSchema = z.object({
  version: z.literal(AST_VERSION),
  nodes: z.array(AstNodeSchema).max(4096),
})

export type ValidateAstResult =
  | { ok: true; ast: TemplateAst }
  | { ok: false; errors: { path: string; message: string }[] }

/**
 * The contract point between the CLI and the server. The CLI runs this on the
 * output of its compiler before uploading and the server runs it again before
 * rendering — the second run is the one that matters, because between them the
 * document went through an HTTP body and a database column.
 */
export const validateAst = (input: unknown): ValidateAstResult => {
  const parsed = TemplateAstSchema.safeParse(input)
  if (parsed.success) return { ok: true, ast: parsed.data as TemplateAst }
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  }
}

/** Wraps nodes in a versioned document, for the CLI and for tests. */
export const astDocument = (nodes: AstNode[]): TemplateAst => ({ version: AST_VERSION, nodes })

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------

interface Scope {
  data: Record<string, unknown>
  bindings: Record<string, unknown>
}

interface AstContext {
  warnings: RenderWarning[]
  options: RenderOptions
}

const resolvePath = (path: AstPath, scope: Scope): unknown => {
  const [head, ...rest] = path.segments
  if (head === undefined) return undefined
  let current: unknown =
    typeof head === 'string' && Object.hasOwn(scope.bindings, head)
      ? scope.bindings[head]
      : scope.data[head as string]
  for (const key of rest) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object' && typeof current !== 'string') return undefined
    current = (current as Record<string | number, unknown>)[key]
  }
  return current
}

const resolveExpr = (expr: AstExpr, scope: Scope): unknown =>
  expr.type === 'literal' ? expr.value : resolvePath(expr, scope)

const applyFilters = (
  value: unknown,
  filters: AstFilter[] | undefined,
  ctx: AstContext,
): unknown => {
  let current = value
  for (const filter of filters ?? []) {
    current = applyValueHelper(filter.name, [current, ...filter.args], ctx.options, ctx.warnings)
  }
  return current
}

const compareValues = (op: CompareOp, left: unknown, right: unknown): boolean => {
  if (op === 'eq') return left === right || stringify(left) === stringify(right)
  if (op === 'ne') return !(left === right || stringify(left) === stringify(right))
  const a = typeof left === 'number' ? left : Number(stringify(left))
  const b = typeof right === 'number' ? right : Number(stringify(right))
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  return op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b
}

const testCondition = (condition: AstCondition, scope: Scope): boolean => {
  switch (condition.type) {
    case 'truthy':
      return isTruthy(resolveExpr(condition.value, scope))
    case 'not':
      return !testCondition(condition.condition, scope)
    case 'compare':
      return compareValues(
        condition.op,
        resolveExpr(condition.left, scope),
        resolveExpr(condition.right, scope),
      )
    case 'and':
      return condition.conditions.every((c) => testCondition(c, scope))
    case 'or':
      return condition.conditions.some((c) => testCondition(c, scope))
  }
}

const resolveValue = (value: AstValue, scope: Scope, ctx: AstContext): unknown =>
  value.type === 'static'
    ? value.value
    : applyFilters(resolvePath(value.expr, scope), value.filters, ctx)

/** Props resolved to plain values, which is all a component renderer gets. */
type Props = Record<string, unknown>

const resolveProps = (
  props: Record<string, AstValue> | undefined,
  scope: Scope,
  ctx: AstContext,
): Props => {
  const out: Props = {}
  for (const [key, value] of Object.entries(props ?? {})) out[key] = resolveValue(value, scope, ctx)
  return out
}

const propString = (props: Props, key: string, fallback = ''): string =>
  props[key] === undefined || props[key] === null ? fallback : stringify(props[key])

const propNumber = (props: Props, key: string): number | undefined => {
  const raw = props[key]
  if (raw === undefined || raw === null || raw === '') return undefined
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : undefined
}

const attr = (name: string, value: string | number | undefined): string =>
  value === undefined || value === '' ? '' : ` ${name}="${escapeHtml(value)}"`

/** Component defaults first, author overrides second — later wins in CSS. */
const style = (base: string, override: string): string =>
  override === '' ? base : `${base.replace(/;?$/, ';')}${override}`

const safeHref = (raw: string, ctx: AstContext): string => {
  if (isSafeUrl(raw)) return raw
  ctx.warnings.push(warn('unsafe_url', 'Dropped a link with an unsupported url scheme.', raw))
  return '#'
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/**
 * Every component renders to markup that survives Outlook 2007-2019, which
 * renders HTML with Word's engine: no flexbox, no grid, no `float` worth
 * relying on, no `max-width` on a block, no `background-size`. Layout is
 * therefore tables with explicit widths, spacing is cellpadding or a padded
 * `<td>` rather than margins, and every rule is an inline `style=` because the
 * `<style>` block is the first thing Gmail's clipper and Outlook.com's
 * sanitiser throw away.
 *
 * `role="presentation"` on every layout table is not decoration: without it a
 * screen reader announces the layout scaffolding as a data table and reads out
 * row and column counts before the content.
 */
const TABLE_ATTRS = 'border="0" cellpadding="0" cellspacing="0" role="presentation"'

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

type ComponentRenderer = (props: Props, inner: string, ctx: AstContext) => string

const COMPONENT_RENDERERS: Record<ComponentName, ComponentRenderer> = {
  /**
   * The XHTML transitional doctype and the VML namespaces are what let the
   * Outlook-only `<!--[if mso]>` fallbacks a template may carry actually run.
   */
  Html: (props, inner) =>
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" ' +
    '"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">' +
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" ' +
    `xmlns:o="urn:schemas-microsoft-com:office:office" lang="${escapeHtml(propString(props, 'lang', 'en'))}">` +
    `${inner}</html>`,

  /**
   * `x-apple-disable-message-reformatting` stops iOS Mail resizing text on its
   * own, which otherwise breaks any layout with a fixed-width table in it.
   */
  Head: (props, inner) =>
    '<head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '<meta name="x-apple-disable-message-reformatting" />' +
    (props.title === undefined ? '' : `<title>${escapeHtml(propString(props, 'title'))}</title>`) +
    `${inner}</head>`,

  Body: (props, inner) => {
    const base =
      `margin:0;padding:0;width:100%;background-color:${propString(props, 'background', '#f6f7f9')};` +
      `font-family:${FONT_STACK};`
    return `<body style="${escapeHtml(style(base, propString(props, 'style')))}">${inner}</body>`
  },

  /**
   * 600px is the width every desktop client shows without a horizontal
   * scrollbar; the outer table exists only to centre the inner one, because
   * `margin:0 auto` on a table is ignored by Word.
   */
  Container: (props, inner) => {
    const width = propNumber(props, 'width') ?? 600
    const base = `width:100%;max-width:${width}px;`
    return (
      `<table ${TABLE_ATTRS} width="100%" style="width:100%;"><tr><td align="center" style="padding:0;">` +
      `<table ${TABLE_ATTRS} width="${width}" style="${escapeHtml(style(base, propString(props, 'style')))}">` +
      `<tr><td style="padding:0;">${inner}</td></tr></table></td></tr></table>`
    )
  },

  Section: (props, inner) => {
    const base =
      `padding:${propString(props, 'padding', '24px')};` +
      (props.background === undefined ? '' : `background-color:${propString(props, 'background')};`)
    return (
      `<table ${TABLE_ATTRS} width="100%" style="width:100%;">` +
      `<tr><td style="${escapeHtml(style(base, propString(props, 'style')))}">${inner}</td></tr></table>`
    )
  },

  Row: (props, inner) =>
    `<table ${TABLE_ATTRS} width="100%" style="${escapeHtml(style('width:100%;', propString(props, 'style')))}">` +
    `<tr>${inner}</tr></table>`,

  /** Only meaningful inside a `Row`; a bare `Column` still emits a valid cell. */
  Column: (props, inner) => {
    const base = 'vertical-align:top;'
    return (
      `<td${attr('width', propNumber(props, 'width'))}${attr('align', propString(props, 'align'))} valign="top" ` +
      `style="${escapeHtml(style(base, propString(props, 'style')))}">${inner}</td>`
    )
  },

  Text: (props, inner) => {
    const base =
      `margin:0 0 16px;font-family:${FONT_STACK};font-size:${propString(props, 'size', '16px')};` +
      `line-height:1.5;color:${propString(props, 'color', '#1f2937')};`
    return `<p style="${escapeHtml(style(base, propString(props, 'style')))}">${inner}</p>`
  },

  Heading: (props, inner) => {
    const level = Math.min(Math.max(propNumber(props, 'level') ?? 1, 1), 6)
    const size = propString(props, 'size', `${32 - (level - 1) * 4}px`)
    const base =
      `margin:0 0 16px;font-family:${FONT_STACK};font-size:${size};line-height:1.25;font-weight:700;` +
      `color:${propString(props, 'color', '#111827')};`
    return `<h${level} style="${escapeHtml(style(base, propString(props, 'style')))}">${inner}</h${level}>`
  },

  /**
   * A "bulletproof" button: the padding lives on the `<a>` so the whole
   * coloured area is clickable, and the background lives on the `<td>` because
   * Word drops `background-color` on an inline element.
   */
  Button: (props, inner, ctx) => {
    const href = safeHref(propString(props, 'href', '#'), ctx)
    const background = propString(props, 'background', '#2563eb')
    const radius = propString(props, 'radius', '6px')
    const base =
      `display:inline-block;padding:12px 24px;font-family:${FONT_STACK};font-size:16px;line-height:1;` +
      `font-weight:600;color:${propString(props, 'color', '#ffffff')};text-decoration:none;border-radius:${radius};`
    return (
      `<table ${TABLE_ATTRS}><tr><td align="center" bgcolor="${escapeHtml(background)}" ` +
      `style="border-radius:${escapeHtml(radius)};background-color:${escapeHtml(background)};">` +
      `<a href="${escapeUrlAttr(href)}" target="_blank" rel="noopener noreferrer" ` +
      `style="${escapeHtml(style(base, propString(props, 'style')))}">${inner}</a></td></tr></table>`
    )
  },

  Link: (props, inner, ctx) => {
    const href = safeHref(propString(props, 'href', '#'), ctx)
    const base = `color:${propString(props, 'color', '#2563eb')};text-decoration:underline;`
    const noTrack = props.track === false ? ' data-ms-no-track' : ''
    return (
      `<a href="${escapeUrlAttr(href)}" target="_blank" rel="noopener noreferrer"${noTrack} ` +
      `style="${escapeHtml(style(base, propString(props, 'style')))}">${inner}</a>`
    )
  },

  /**
   * `display:block` kills the descender gap Outlook and Gmail leave under an
   * inline image, which shows up as a hairline in a stack of sliced images.
   */
  Img: (props, _inner, ctx) => {
    const src = safeHref(propString(props, 'src'), ctx)
    const alt = propString(props, 'alt')
    if (alt === '') {
      ctx.warnings.push(warn('image_missing_alt', 'Image has no alt text.', src))
    }
    const base =
      'display:block;border:0;outline:none;text-decoration:none;max-width:100%;height:auto;'
    return (
      `<img src="${escapeUrlAttr(src)}" alt="${escapeHtml(alt)}"${attr('width', propNumber(props, 'width'))}` +
      `${attr('height', propNumber(props, 'height'))} border="0" ` +
      `style="${escapeHtml(style(base, propString(props, 'style')))}" />`
    )
  },

  /** A bordered `<td>` rather than `<hr>`, which Word renders at its own width. */
  Hr: (props) => {
    const base = `border-top:1px solid ${propString(props, 'color', '#e5e7eb')};font-size:0;line-height:0;height:1px;`
    return (
      `<table ${TABLE_ATTRS} width="100%" style="width:100%;"><tr>` +
      `<td style="${escapeHtml(style(base, propString(props, 'style')))}">&nbsp;</td></tr></table>`
    )
  },

  /**
   * The preheader: the line an inbox shows after the subject. Hidden in the
   * body, then padded with zero-width joiners so the client cannot pull the
   * first paragraph of real copy in after it — without the padding, "Your
   * receipt View in browser Hi Jane…" is what the recipient sees.
   */
  Preview: (_props, inner) =>
    '<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">' +
    `${inner}${'&#847;&zwnj;&nbsp;'.repeat(30)}</div>`,

  CodeBlock: (props, inner) => {
    const base =
      "margin:0 0 16px;padding:16px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;" +
      `font-size:13px;line-height:1.5;background-color:${propString(props, 'background', '#f3f4f6')};` +
      `color:${propString(props, 'color', '#111827')};border-radius:6px;white-space:pre-wrap;word-break:break-word;`
    return `<pre style="${escapeHtml(style(base, propString(props, 'style')))}">${inner}</pre>`
  },
}

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

const renderNodes = (nodes: AstNode[], scope: Scope, ctx: AstContext): string => {
  let out = ''
  for (const node of nodes) out += renderNode(node, scope, ctx)
  return out
}

const renderElement = (node: AstElement, scope: Scope, ctx: AstContext): string => {
  let attrs = ''
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    // Re-checked at render time, not only at validation time: the value of a
    // url attribute may be dynamic, and a contact field holding
    // `javascript:...` is exactly the data an attacker controls.
    const resolved = stringify(resolveValue(value, scope, ctx))
    if (URL_ATTRIBUTES.has(name)) {
      if (!isSafeUrl(resolved)) {
        ctx.warnings.push(
          warn('unsafe_url', `Dropped \`${name}\` with an unsupported url scheme.`, resolved),
        )
        continue
      }
      if (resolved !== '') attrs += ` ${name}="${escapeUrlAttr(resolved)}"`
      continue
    }
    attrs += attr(name, resolved)
  }
  const inner = node.children === undefined ? '' : renderNodes(node.children, scope, ctx)
  return VOID_TAGS.has(node.tag)
    ? `<${node.tag}${attrs} />`
    : `<${node.tag}${attrs}>${inner}</${node.tag}>`
}

const renderLoop = (node: AstLoop, scope: Scope, ctx: AstContext): string => {
  const source = resolvePath(node.source, scope)
  const entries = Array.isArray(source)
    ? source
    : typeof source === 'object' && source !== null
      ? Object.values(source as Record<string, unknown>)
      : []
  if (entries.length === 0)
    return node.empty === undefined ? '' : renderNodes(node.empty, scope, ctx)

  let out = ''
  for (const [index, entry] of entries.entries()) {
    const bindings = { ...scope.bindings, [node.item]: entry }
    if (node.index !== undefined) bindings[node.index] = index
    out += renderNodes(node.body, { data: scope.data, bindings }, ctx)
  }
  return out
}

const renderNode = (node: AstNode, scope: Scope, ctx: AstContext): string => {
  switch (node.type) {
    case 'text':
      // Text nodes come from the compiler, not from data, but they are escaped
      // anyway: it costs nothing and it means a hand-written AST posted
      // straight to the API cannot smuggle markup through a text node.
      return escapeHtml(node.value)
    case 'interpolation': {
      const value = applyFilters(resolvePath(node.expr, scope), node.filters, ctx)
      if (value === undefined) {
        const path = node.expr.segments.join('.')
        ctx.warnings.push(warn('missing_variable', `No value for \`${path}\`.`, path))
      }
      return escapeHtml(stringify(value))
    }
    case 'element':
      return renderElement(node, scope, ctx)
    case 'component': {
      const props = resolveProps(node.props, scope, ctx)
      const inner = node.children === undefined ? '' : renderNodes(node.children, scope, ctx)
      return COMPONENT_RENDERERS[node.name](props, inner, ctx)
    }
    case 'conditional':
      return testCondition(node.test, scope)
        ? renderNodes(node.consequent, scope, ctx)
        : node.alternate === undefined
          ? ''
          : renderNodes(node.alternate, scope, ctx)
    case 'loop':
      return renderLoop(node, scope, ctx)
  }
}

export interface AstRenderResult {
  html: string
  warnings: RenderWarning[]
}

/** Validates, then interprets. Invalid documents render empty, with a warning. */
export const renderAst = (
  input: unknown,
  data: Record<string, unknown> = {},
  options: RenderOptions = {},
): AstRenderResult => {
  const validated = validateAst(input)
  if (!validated.ok) {
    return {
      html: '',
      warnings: validated.errors.map((e) => warn('ast_invalid', e.message, e.path)),
    }
  }
  const ctx: AstContext = { warnings: [], options }
  const html = renderNodes(validated.ast.nodes, { data, bindings: {} }, ctx)
  return { html, warnings: ctx.warnings }
}

// ---------------------------------------------------------------------------
// Variable extraction
// ---------------------------------------------------------------------------

/**
 * Paths the document reads from `data`. Loop bodies are reported against the
 * array they iterate (`items[].name`) so the preview form knows which fields
 * repeat; loop bindings themselves are not caller-supplied and are skipped.
 */
export const extractAstVariables = (input: unknown): string[] => {
  const validated = validateAst(input)
  if (!validated.ok) return []
  const found = new Set<string>()

  const record = (path: AstPath, prefix: Record<string, string>): void => {
    const [head, ...rest] = path.segments
    if (head === undefined) return
    const base =
      typeof head === 'string' && prefix[head] !== undefined ? prefix[head] : String(head)
    found.add([base, ...rest.map(String)].join('.'))
  }

  const walkExpr = (expr: AstExpr, prefix: Record<string, string>): void => {
    if (expr.type === 'path') record(expr, prefix)
  }

  const walkCondition = (condition: AstCondition, prefix: Record<string, string>): void => {
    switch (condition.type) {
      case 'truthy':
        walkExpr(condition.value, prefix)
        break
      case 'not':
        walkCondition(condition.condition, prefix)
        break
      case 'compare':
        walkExpr(condition.left, prefix)
        walkExpr(condition.right, prefix)
        break
      case 'and':
      case 'or':
        for (const c of condition.conditions) walkCondition(c, prefix)
    }
  }

  const walk = (nodes: AstNode[], prefix: Record<string, string>): void => {
    for (const node of nodes) {
      switch (node.type) {
        case 'interpolation':
          record(node.expr, prefix)
          break
        case 'element':
        case 'component': {
          const values = Object.values(
            node.type === 'element' ? (node.attrs ?? {}) : (node.props ?? {}),
          )
          for (const value of values) if (value.type === 'dynamic') record(value.expr, prefix)
          if (node.children !== undefined) walk(node.children, prefix)
          break
        }
        case 'conditional':
          walkCondition(node.test, prefix)
          walk(node.consequent, prefix)
          if (node.alternate !== undefined) walk(node.alternate, prefix)
          break
        case 'loop': {
          record(node.source, prefix)
          const [head, ...rest] = node.source.segments
          const sourcePath = [
            typeof head === 'string' && prefix[head] !== undefined ? prefix[head] : String(head),
          ]
            .concat(rest.map(String))
            .join('.')
          const inner = { ...prefix, [node.item]: `${sourcePath}[]` }
          // The index binding is generated, not supplied, so it must not show
          // up in the preview form.
          if (node.index !== undefined) inner[node.index] = '@index'
          walk(node.body, inner)
          if (node.empty !== undefined) walk(node.empty, prefix)
          break
        }
        case 'text':
          break
      }
    }
  }

  walk(validated.ast.nodes, {})
  return [...found].filter((path) => !path.startsWith('@')).sort()
}
