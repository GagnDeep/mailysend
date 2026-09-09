import { escapeHtml, parseAttrs, scanTags } from './html.ts'
import type { RenderWarning } from './types.ts'
import { warn } from './types.ts'

/**
 * A CSS inliner sized for email.
 *
 * Gmail drops the `<style>` block in the clipped view and in every forwarded
 * message, Outlook.com rewrites it, and several Android clients ignore it in
 * the preview pane. A rule that only exists in a style block therefore applies
 * "usually", which is the worst possible property for a brand's layout. So
 * anything that *can* be an inline `style=` becomes one.
 *
 * What stays behind in the block is what cannot be inlined and still work:
 * media queries (there is no inline equivalent of a breakpoint) and
 * pseudo-classes and pseudo-elements. Those clients that honour `<style>` get
 * the responsive treatment; the rest get the inlined base, which is why an
 * email is authored mobile-last rather than mobile-first.
 *
 * Selector support is deliberately shallow — tag, `.class`, `#id`, and
 * descendant combinations of those. Child and sibling combinators are left in
 * the block rather than half-matched, because a silently mis-applied rule is
 * harder to debug than one that plainly did not apply.
 */

interface Declaration {
  property: string
  value: string
}

interface Rule {
  selector: string
  specificity: number
  order: number
  declarations: Declaration[]
}

interface CompoundPart {
  tag: string | null
  id: string | null
  classes: string[]
}

interface ParsedSelector {
  parts: CompoundPart[]
  specificity: number
}

const COMPOUND_RE = /^(?:([a-zA-Z][a-zA-Z0-9-]*)|\*)?((?:[.#][A-Za-z_][\w-]*)*)$/

const parseSelector = (selector: string): ParsedSelector | null => {
  const tokens = selector.trim().split(/\s+/)
  if (tokens.length === 0 || tokens.length > 8) return null
  const parts: CompoundPart[] = []
  let specificity = 0
  for (const token of tokens) {
    const match = COMPOUND_RE.exec(token)
    if (match === null) return null
    const tag = match[1] === undefined ? null : match[1].toLowerCase()
    const rest = match[2] ?? ''
    let id: string | null = null
    const classes: string[] = []
    for (const piece of rest.match(/[.#][A-Za-z_][\w-]*/g) ?? []) {
      if (piece[0] === '#') id = piece.slice(1)
      else classes.push(piece.slice(1))
    }
    if (tag === null && id === null && classes.length === 0 && token !== '*') return null
    specificity += (id === null ? 0 : 100) + classes.length * 10 + (tag === null ? 0 : 1)
    parts.push({ tag, id, classes })
  }
  return { parts, specificity }
}

export const parseDeclarations = (source: string): Declaration[] => {
  const out: Declaration[] = []
  // Split on semicolons that are not inside a url() or a quoted string, so
  // `background:url(a;b)` and `content:";"` survive.
  for (const chunk of source.split(/;(?![^(]*\))(?=(?:[^"']*["'][^"']*["'])*[^"']*$)/)) {
    const colon = chunk.indexOf(':')
    if (colon === -1) continue
    const property = chunk.slice(0, colon).trim().toLowerCase()
    const value = chunk.slice(colon + 1).trim()
    if (property === '' || value === '') continue
    out.push({ property, value })
  }
  return out
}

const serializeDeclarations = (declarations: Declaration[]): string =>
  declarations.map((d) => `${d.property}:${d.value}`).join(';')

interface StyleBlock {
  start: number
  end: number
  css: string
}

const findStyleBlocks = (html: string): StyleBlock[] => {
  const blocks: StyleBlock[] = []
  const re = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi
  for (let match = re.exec(html); match !== null; match = re.exec(html)) {
    blocks.push({ start: match.index, end: match.index + match[0].length, css: match[1] ?? '' })
  }
  return blocks
}

interface ParsedSheet {
  rules: Rule[]
  /** Source that must stay in the `<style>` block. */
  retained: string[]
  /** Selectors that could not be inlined, for the warning. */
  retainedSelectors: string[]
}

const parseSheet = (css: string, startOrder: number): ParsedSheet => {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: Rule[] = []
  const retained: string[] = []
  const retainedSelectors: string[] = []
  let order = startOrder
  let i = 0

  while (i < source.length) {
    const braceStart = source.indexOf('{', i)
    if (braceStart === -1) break
    const prelude = source.slice(i, braceStart).trim()

    // Find the matching close brace, counting nesting so `@media` bodies stay whole.
    let depth = 0
    let j = braceStart
    for (; j < source.length; j++) {
      if (source[j] === '{') depth++
      else if (source[j] === '}' && --depth === 0) break
    }
    const body = source.slice(braceStart + 1, j)
    i = j + 1

    if (prelude.startsWith('@')) {
      // Media queries and font faces have no inline form; they only work in
      // clients that keep the block, and those clients also keep them working.
      retained.push(`${prelude}{${body}}`)
      continue
    }

    const declarations = parseDeclarations(body)
    if (declarations.length === 0) continue

    const keep: string[] = []
    for (const selector of prelude.split(',')) {
      const trimmed = selector.trim()
      if (trimmed === '') continue
      const parsed = parseSelector(trimmed)
      if (parsed === null) {
        keep.push(trimmed)
        retainedSelectors.push(trimmed)
        continue
      }
      rules.push({
        selector: trimmed,
        specificity: parsed.specificity,
        order: order++,
        declarations,
      })
    }
    if (keep.length > 0) retained.push(`${keep.join(',')}{${body.trim()}}`)
  }

  return { rules, retained, retainedSelectors }
}

interface StackEntry {
  tag: string
  id: string | null
  classes: string[]
}

const matchesCompound = (part: CompoundPart, entry: StackEntry): boolean => {
  if (part.tag !== null && part.tag !== entry.tag) return false
  if (part.id !== null && part.id !== entry.id) return false
  return part.classes.every((c) => entry.classes.includes(c))
}

/** Right-to-left descendant match, the same order a browser uses. */
const matches = (parts: CompoundPart[], stack: StackEntry[]): boolean => {
  const target = stack[stack.length - 1]
  const last = parts[parts.length - 1]
  if (target === undefined || last === undefined) return false
  if (!matchesCompound(last, target)) return false
  let ancestorIndex = stack.length - 2
  for (let p = parts.length - 2; p >= 0; p--) {
    const part = parts[p] as CompoundPart
    let found = false
    while (ancestorIndex >= 0) {
      if (matchesCompound(part, stack[ancestorIndex] as StackEntry)) {
        found = true
        ancestorIndex--
        break
      }
      ancestorIndex--
    }
    if (!found) return false
  }
  return true
}

export interface InlineResult {
  html: string
  warnings: RenderWarning[]
}

export const inlineCss = (html: string): InlineResult => {
  const warnings: RenderWarning[] = []
  const blocks = findStyleBlocks(html)
  if (blocks.length === 0) return { html, warnings }

  const rules: Rule[] = []
  const replacements: { start: number; end: number; text: string }[] = []
  for (const block of blocks) {
    const sheet = parseSheet(block.css, rules.length)
    rules.push(...sheet.rules)
    const retained = sheet.retained.join('\n')
    replacements.push({
      start: block.start,
      end: block.end,
      text: retained === '' ? '' : `<style type="text/css">\n${retained}\n</style>`,
    })
    for (const selector of sheet.retainedSelectors) {
      warnings.push(
        warn(
          'uninlinable_css',
          'Selector cannot be inlined; it only applies where <style> survives.',
          selector,
        ),
      )
    }
  }

  const parsed = rules
    .map((rule) => ({ rule, selector: parseSelector(rule.selector) }))
    .filter((entry): entry is { rule: Rule; selector: ParsedSelector } => entry.selector !== null)

  const stack: StackEntry[] = []
  const edits: { start: number; end: number; text: string }[] = []

  for (const tag of scanTags(html)) {
    if (tag.closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]?.tag === tag.name) {
          stack.length = i
          break
        }
      }
      continue
    }

    const attrs = parseAttrs(tag.attrs)
    const entry: StackEntry = {
      tag: tag.name,
      id: attrs.get('id') ?? null,
      classes: (attrs.get('class') ?? '').split(/\s+/).filter(Boolean),
    }
    stack.push(entry)

    const matched = parsed
      .filter((p) => matches(p.selector.parts, stack))
      .sort((a, b) =>
        a.rule.specificity === b.rule.specificity
          ? a.rule.order - b.rule.order
          : a.rule.specificity - b.rule.specificity,
      )

    if (matched.length > 0) {
      const merged = new Map<string, string>()
      for (const { rule } of matched)
        for (const d of rule.declarations) merged.set(d.property, d.value)
      // The author's own `style=` is applied last: an inline declaration
      // already beat every selector in the cascade, and inlining must not
      // change which one wins.
      for (const d of parseDeclarations(attrs.get('style') ?? '')) merged.set(d.property, d.value)

      const value = serializeDeclarations(
        [...merged].map(([property, v]) => ({ property, value: v })),
      )
      const rewritten = attrs.has('style')
        ? tag.attrs.replace(
            /\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i,
            ` style="${escapeHtml(value)}"`,
          )
        : `${tag.attrs} style="${escapeHtml(value)}"`
      edits.push({
        start: tag.start,
        end: tag.end,
        text: `<${tag.name}${rewritten}${tag.selfClosing && !tag.attrs.endsWith('/') ? ' /' : ''}>`,
      })
    }

    if (tag.selfClosing) stack.pop()
  }

  const all = [...edits, ...replacements].sort((a, b) => b.start - a.start)
  let out = html
  for (const edit of all) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  return { html: out, warnings }
}

/**
 * Stamps the attributes every layout table needs. `cellpadding`/`cellspacing`
 * default to non-zero in Outlook and older Gmail, which is where the mystery
 * two-pixel gaps in a sliced hero image come from, and `role="presentation"`
 * stops a screen reader announcing the layout scaffolding as a data table.
 */
export const ensureTableLayout = (html: string): string => {
  const edits: { start: number; end: number; text: string }[] = []
  for (const tag of scanTags(html)) {
    if (tag.name !== 'table' || tag.closing) continue
    const attrs = parseAttrs(tag.attrs)
    let extra = ''
    if (!attrs.has('border')) extra += ' border="0"'
    if (!attrs.has('cellpadding')) extra += ' cellpadding="0"'
    if (!attrs.has('cellspacing')) extra += ' cellspacing="0"'
    if (!attrs.has('role')) extra += ' role="presentation"'
    if (extra === '') continue
    edits.push({ start: tag.start, end: tag.end, text: `<table${extra}${tag.attrs}>` })
  }
  let out = html
  for (const edit of edits.reverse())
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  return out
}
