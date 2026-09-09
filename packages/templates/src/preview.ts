import { extractAstVariables } from './ast.ts'
import { extractHandlebarsVariables } from './handlebars.ts'
import type { Engine } from './types.ts'

/**
 * What the dashboard needs to render a preview form and a non-blank preview.
 *
 * Variable paths use dots for nesting and `[]` for "this repeats":
 * `user.first_name`, `items[].name`. That shape is what both engines' walkers
 * already produce and what `generatePreviewData` reads back, so the form, the
 * preview and the stored `template_versions.variables` all agree.
 */

export interface ExtractVariablesInput {
  engine: Engine
  subject?: string | null
  html?: string | null
  text?: string | null
  ast?: unknown
}

export const extractVariables = (input: ExtractVariablesInput): string[] => {
  const found = new Set<string>()
  // The subject goes through the Handlebars interpolator on every engine, so
  // its variables are always Handlebars-shaped.
  for (const path of extractHandlebarsVariables(input.subject ?? '')) found.add(path)

  switch (input.engine) {
    case 'handlebars':
    case 'mjml':
      for (const path of extractHandlebarsVariables(input.html ?? '')) found.add(path)
      for (const path of extractHandlebarsVariables(input.text ?? '')) found.add(path)
      break
    case 'jsx-ast':
      for (const path of extractAstVariables(input.ast)) found.add(path)
      for (const path of extractHandlebarsVariables(input.text ?? '')) found.add(path)
      break
    case 'html':
      // Raw bodies are not interpolated, so anything mustache-shaped in one is
      // not a variable. See the `html` branch of `renderBody`.
      break
  }

  return [...found].sort()
}

/**
 * Plausible sample values, keyed off what the field is called.
 *
 * A preview full of `{{first_name}}` or of empty strings is worse than no
 * preview: the author cannot see whether their layout survives a long name or
 * a three-item loop, which is the entire reason they opened the preview. The
 * heuristics below are shallow on purpose — the goal is "looks like a real
 * email", not correctness.
 */
const SAMPLES: [RegExp, unknown][] = [
  [/^(unsubscribe_url|unsub_url)$/, 'https://example.com/unsubscribe/abc123'],
  [/(^|_)email(_|$)|^email$/, 'jane@example.com'],
  [/(^|_)(first_?name)$/, 'Jane'],
  [/(^|_)(last_?name|surname)$/, 'Doe'],
  [/(^|_)(full_?name|name)$/, 'Jane Doe'],
  [/(^|_)(company|organi[sz]ation|brand)(_|$)/, 'Acme Inc.'],
  [/(^|_)(avatar|photo|image|img|logo|thumbnail)(_|$)/, 'https://example.com/image.png'],
  [/(^|_)(url|link|href)(_|$)/, 'https://example.com'],
  [/(^|_)(price|amount|total|cost|subtotal|balance)(_|$)/, 49.99],
  [/(^|_)(count|qty|quantity|items?_count)(_|$)/, 3],
  [/(^|_)(date|_at|day|expires|deadline)(_|$)|_at$/, '2026-03-14T10:00:00.000Z'],
  [/^(is|has|should|can)_/, true],
  [/(^|_)id$/, 'abc123'],
  [/(^|_)(title|subject|heading|headline)(_|$)/, 'Welcome aboard'],
  [/(^|_)(city|town)(_|$)/, 'Melbourne'],
  [/(^|_)(country)(_|$)/, 'Australia'],
  [/(^|_)(phone|mobile|tel)(_|$)/, '+61 400 000 000'],
  [/(^|_)(code|token|otp)(_|$)/, '482913'],
  [/(^|_)(description|body|message|content|text|summary)(_|$)/, 'A short line of sample copy.'],
]

const humanize = (key: string): string => {
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
  return words === '' ? 'Sample' : words[0]!.toUpperCase() + words.slice(1)
}

const sampleFor = (key: string): unknown => {
  const lower = key.toLowerCase()
  for (const [pattern, value] of SAMPLES) if (pattern.test(lower)) return value
  return `Sample ${humanize(lower).toLowerCase()}`
}

/** How many entries a repeating path gets, so wrapping and zebra striping show. */
const LOOP_SAMPLE_SIZE = 3

interface Node {
  children: Map<string, Node>
  repeats: boolean
  leaf: boolean
}

const emptyNode = (): Node => ({ children: new Map(), repeats: false, leaf: false })

export const generatePreviewData = (variables: readonly string[]): Record<string, unknown> => {
  const root = emptyNode()

  for (const variable of variables) {
    let node = root
    for (const raw of variable.split('.')) {
      if (raw === '') continue
      const repeats = raw.endsWith('[]')
      const key = repeats ? raw.slice(0, -2) : raw
      let child = node.children.get(key)
      if (child === undefined) {
        child = emptyNode()
        node.children.set(key, child)
      }
      if (repeats) child.repeats = true
      node = child
    }
    node.leaf = true
  }

  const build = (node: Node, key: string): unknown => {
    if (node.children.size === 0) return sampleFor(key)
    const shape: Record<string, unknown> = {}
    for (const [childKey, child] of node.children) shape[childKey] = build(child, childKey)
    return shape
  }

  const out: Record<string, unknown> = {}
  for (const [key, node] of root.children) {
    if (!node.repeats) {
      out[key] = build(node, key)
      continue
    }
    // A repeating path whose leaves are all scalars is an array of scalars; one
    // with named children is an array of objects.
    const entry = build(node, key)
    out[key] = Array.from({ length: LOOP_SAMPLE_SIZE }, (_, i) =>
      typeof entry === 'object' && entry !== null
        ? Object.fromEntries(
            Object.entries(entry as Record<string, unknown>).map(([k, v]) => [
              k,
              typeof v === 'string' && !v.startsWith('http') ? `${v} ${i + 1}` : v,
            ]),
          )
        : `${String(entry)} ${i + 1}`,
    )
  }
  return out
}
