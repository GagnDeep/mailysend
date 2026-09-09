/**
 * The rejection catalogue.
 *
 * `packages/templates/src/ast.ts` is a *data-only* document format: the render
 * worker walks six node shapes whose expression language is property access
 * and nothing else. It has no evaluator, and adding one would put a customer's
 * template body — arbitrary data we store and later render in a shared isolate
 * on behalf of a different customer's send — one bug away from a sandbox
 * escape.
 *
 * So this compiler has exactly two outcomes for any construct: lower it to the
 * AST, or refuse it by name. The forbidden third outcome is falling back to
 * string interpolation, which would look like it worked and would ship an
 * unevaluated `{formatDate(x)}` into a customer's inbox — or, worse, would
 * quietly move evaluation to the server. Every entry below therefore exists so
 * that a construct the AST cannot express fails loudly at push time, on the
 * developer's machine, with a file and a line.
 */

export const UNSUPPORTED = {
  'function-call':
    'Calls are not evaluated by the render worker. Precompute the value, or use a filter: f.upper(x), f.formatDate(x, "medium").',
  'unknown-filter': 'Not a MailySend filter.',
  'filter-argument':
    'Filter arguments must be literals — the worker cannot evaluate an expression to produce one.',
  'reserved-filter-namespace': '`f` is the filter namespace and cannot also be a prop.',
  'create-element': 'React.createElement is a call. Write the element as JSX.',
  'template-literal':
    'Template literals interpolate at runtime. Use a single {expression}, or split the static text out.',
  'tagged-template': 'Tagged templates run a function.',
  'arithmetic-operator': 'Arithmetic is not part of the expression language.',
  'string-concatenation':
    'String concatenation happens at runtime. Put the literal text in the JSX and the value in its own {expression}.',
  'logical-value':
    '&&, || and ?? may only be a conditional test, never a value — the AST has no lazy value form.',
  'ternary-in-attribute':
    'An attribute value is a static literal or a path, never a choice between two. Wrap the element in {cond ? <A/> : <B/>} instead.',
  'unary-operator': 'Only `!` is supported, and only as a conditional test.',
  'typeof-operator': 'typeof inspects a runtime value.',
  'instanceof-operator': 'instanceof inspects a runtime prototype chain.',
  'sequence-expression': 'The comma operator evaluates and discards.',
  assignment: 'A template is a pure projection of its data and cannot assign.',
  'update-expression': '++ and -- mutate.',
  'new-expression': 'Constructors run code.',
  'await-expression': 'A template renders synchronously from data already loaded.',
  'optional-call': 'x?.() is still a call.',
  'spread-attribute': 'Spread props are resolved at runtime. Name each prop.',
  'spread-child': 'Spread children are resolved at runtime.',
  'spread-element': 'Spread in an argument list is resolved at runtime.',
  'computed-member':
    'obj[key] needs the key evaluated. Only literal keys are addressable: obj.name or obj[0].',
  'member-expression-root': 'A path must start at a prop or a loop binding.',
  'prototype-path': 'Prototype access is refused by the AST schema.',
  'unresolved-identifier':
    'Not a prop or a loop binding. The worker has no scope beyond the data you pass it.',
  'array-method':
    'Only .map() is expressible — it lowers to a loop node. Every other array method runs code.',
  'map-callback': '.map() must be given an inline arrow returning JSX.',
  'destructured-loop-param':
    'A loop binding must be a plain name; the AST addresses loop entries by binding, not by pattern.',
  'function-expression': 'Functions are only allowed as the .map() callback.',
  'event-handler': 'Email has no event loop. Handlers cannot be delivered.',
  'dangerous-html': 'Raw HTML would bypass every escape the renderer applies.',
  'unknown-component': 'Not a MailySend email component.',
  'disallowed-element': 'This element is not allowed in email HTML.',
  'disallowed-attribute': 'This attribute is not allowed in email HTML.',
  'dynamic-style-object':
    'A style object is serialised at compile time, so every value must be a literal. Use style={variable} for a dynamic string.',
  'object-value': 'Object literals are not a value the AST can carry.',
  'array-value': 'Array literals are not a value the AST can carry.',
  'regexp-literal': 'Regular expressions execute.',
  'jsx-in-value': 'JSX is a node, not a value. Move the element into the children.',
  'jsx-namespaced-name': 'Namespaced JSX names have no meaning here.',
  'jsx-member-element': 'Dotted component names are resolved at runtime.',
  'statement-in-component':
    'A template component is a single `return` of JSX — a statement would need to be evaluated.',
  'multiple-returns': 'A template component returns exactly once.',
  'destructuring-default':
    'A default value is evaluated when the prop is missing. Use the `default` filter: f.default(name, "there").',
  'rest-element': 'A rest pattern collects props at runtime.',
  'no-default-export':
    'No default export found. `templates push` compiles the default-exported component.',
  'not-a-component': 'The default export must be a function component returning JSX.',
  'empty-template': 'The component returned nothing to render.',
  'schema-rejected': 'The template AST schema refused this node.',
} as const

export type UnsupportedCode = keyof typeof UNSUPPORTED

export interface SourceLocation {
  line: number
  column: number
}

export interface Diagnostic {
  code: UnsupportedCode
  /** The catalogue reason, plus whatever is specific to this occurrence. */
  message: string
  loc: SourceLocation
  /** The offending source text, single-lined so a diagnostic is one row. */
  excerpt: string
}

export interface BabelNodeLike {
  loc?: { start: { line: number; column: number } } | null
  start?: number | null
  end?: number | null
}

const EXCERPT_MAX = 96

export const excerptOf = (source: string, node: BabelNodeLike): string => {
  const from = node.start ?? 0
  const to = Math.min(node.end ?? from, from + 400)
  const text = source.slice(from, to).replace(/\s+/g, ' ').trim()
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX - 1)}…` : text
}

export const diagnostic = (
  source: string,
  node: BabelNodeLike,
  code: UnsupportedCode,
  detail?: string,
): Diagnostic => ({
  code,
  message: detail === undefined ? UNSUPPORTED[code] : `${detail} ${UNSUPPORTED[code]}`,
  loc: { line: node.loc?.start.line ?? 0, column: (node.loc?.start.column ?? 0) + 1 },
  excerpt: excerptOf(source, node),
})
