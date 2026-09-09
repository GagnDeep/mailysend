import { parse } from '@babel/parser'
import * as t from '@babel/types'
import type {
  AstCondition,
  AstExpr,
  AstFilter,
  AstLiteral,
  AstNode,
  AstPath,
  AstValue,
  CompareOp,
  ComponentName,
  FilterName,
  TemplateAst,
} from '@mailysend/templates'
import {
  AstNodeSchema,
  AstPathSchema,
  astDocument,
  COMPONENTS,
  extractAstVariables,
  validateAst,
} from '@mailysend/templates'
import type { Diagnostic, UnsupportedCode } from './diagnostics.ts'
import { diagnostic } from './diagnostics.ts'

/**
 * JSX → the restricted, data-only template AST.
 *
 * This runs on the developer's machine, where a real parser and a filesystem
 * are unremarkable, and produces a document the render worker can walk without
 * ever evaluating anything. The compiler is therefore the *only* place where
 * "what a template may say" is decided, and it decides by refusing everything
 * it cannot lower — see `diagnostics.ts` for why a silent fallback would be
 * the one unacceptable outcome.
 *
 * The allowlists (elements, attributes, component names, path segments) are
 * deliberately not duplicated here. Every node this compiler builds is checked
 * against `AstNodeSchema` from `@mailysend/templates` before it is accepted, so
 * the CLI and the server cannot drift: there is one list, in the package that
 * also does the rendering.
 */

/**
 * Filters need a surface syntax, and JSX has no pipe operator. Every candidate
 * — `x | upper`, a tagged template, a helper import — is either a syntax error
 * or an operator the expression language does not have.
 *
 * So filters are spelled as calls into one reserved namespace: `f.upper(x)`,
 * `f.truncate(post.body, 120)`, nesting for chains. They are a *call in
 * appearance only*: the compiler matches the exact shape `f.<known filter>`
 * and lowers it to an `AstFilter` record, and every other call in the file is
 * rejected. `f` is reserved — a prop of that name is an error — precisely so
 * that whether something is a filter can be decided lexically rather than by
 * resolving a name at render time.
 */
const FILTER_NAMESPACE = 'f'

const FILTERS = new Set<string>([
  'upper',
  'lower',
  'capitalize',
  'default',
  'truncate',
  'formatDate',
  'formatNumber',
  'pluralize',
])

/** Named so the diagnostic can say which method, rather than "a call". */
const ARRAY_METHODS = new Set([
  'concat',
  'every',
  'filter',
  'find',
  'findIndex',
  'flat',
  'flatMap',
  'forEach',
  'includes',
  'indexOf',
  'join',
  'reduce',
  'reverse',
  'slice',
  'some',
  'sort',
  'splice',
])

const COMPARISONS: Record<string, CompareOp> = {
  '===': 'eq',
  '==': 'eq',
  '!==': 'ne',
  '!=': 'ne',
  '<': 'lt',
  '<=': 'lte',
  '>': 'gt',
  '>=': 'gte',
}

/** React spellings that have an unambiguous HTML equivalent in the allowlist. */
const ATTRIBUTE_ALIASES: Record<string, string> = { className: 'class', htmlFor: 'for' }

const COMPONENT_NAMES = new Set<string>(COMPONENTS)

export interface CompileOptions {
  /** Shown in diagnostics. Not read from disk — callers pass source in. */
  filename?: string
}

export type CompileResult =
  | { ok: true; ast: TemplateAst; variables: string[] }
  | { ok: false; diagnostics: Diagnostic[] }

type Scope = Map<string, (string | number)[]>

type Expression = t.Expression | t.JSXEmptyExpression

class Compiler {
  readonly #source: string
  readonly diagnostics: Diagnostic[] = []
  #scopes: Scope[] = []

  constructor(source: string) {
    this.#source = source
  }

  #reject(node: t.Node, code: UnsupportedCode, detail?: string): null {
    this.diagnostics.push(diagnostic(this.#source, node, code, detail))
    return null
  }

  #lookup(name: string): (string | number)[] | undefined {
    for (let i = this.#scopes.length - 1; i >= 0; i--) {
      const found = this.#scopes[i]?.get(name)
      if (found) return found
    }
    return undefined
  }

  #push(scope: Scope) {
    this.#scopes.push(scope)
  }

  #pop() {
    this.#scopes.pop()
  }

  // -------------------------------------------------------------------------
  // Expressions
  // -------------------------------------------------------------------------

  /** TypeScript-only wrappers are erased by the compiler and carry no meaning. */
  #unwrap(node: t.Node): t.Node {
    let current = node
    for (;;) {
      if (
        t.isTSAsExpression(current) ||
        t.isTSSatisfiesExpression(current) ||
        t.isTSNonNullExpression(current) ||
        t.isTSTypeAssertion(current) ||
        t.isTSInstantiationExpression(current)
      ) {
        current = current.expression
        continue
      }
      if (t.isParenthesizedExpression(current)) {
        current = current.expression
        continue
      }
      return current
    }
  }

  /**
   * Names the construct. Every path that cannot lower ends here, so that a
   * refusal always says *what* was refused rather than "unsupported syntax".
   */
  #classify(input: t.Node): null {
    const node = this.#unwrap(input)

    if (t.isOptionalCallExpression(node)) return this.#reject(node, 'optional-call')
    if (t.isCallExpression(node)) return this.#classifyCall(node)
    if (t.isNewExpression(node)) return this.#reject(node, 'new-expression')
    if (t.isAwaitExpression(node)) return this.#reject(node, 'await-expression')
    if (t.isTaggedTemplateExpression(node)) return this.#reject(node, 'tagged-template')
    if (t.isTemplateLiteral(node)) return this.#reject(node, 'template-literal')
    if (t.isSequenceExpression(node)) return this.#reject(node, 'sequence-expression')
    if (t.isAssignmentExpression(node)) return this.#reject(node, 'assignment')
    if (t.isUpdateExpression(node)) return this.#reject(node, 'update-expression')
    if (t.isRegExpLiteral(node)) return this.#reject(node, 'regexp-literal')
    if (t.isObjectExpression(node)) return this.#reject(node, 'object-value')
    if (t.isArrayExpression(node)) return this.#reject(node, 'array-value')
    if (t.isSpreadElement(node)) return this.#reject(node, 'spread-element')
    if (t.isJSXElement(node) || t.isJSXFragment(node)) return this.#reject(node, 'jsx-in-value')
    if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) {
      return this.#reject(node, 'function-expression')
    }
    if (t.isLogicalExpression(node)) {
      return this.#reject(node, 'logical-value', `\`${node.operator}\` produces a value here.`)
    }

    if (t.isUnaryExpression(node)) {
      if (node.operator === 'typeof') return this.#reject(node, 'typeof-operator')
      return this.#reject(node, 'unary-operator', `\`${node.operator}\` is an operator.`)
    }

    if (t.isBinaryExpression(node)) {
      if (node.operator === 'instanceof') return this.#reject(node, 'instanceof-operator')
      if (node.operator in COMPARISONS) {
        return this.#reject(node, 'logical-value', `\`${node.operator}\` produces a value here.`)
      }
      if (
        node.operator === '+' &&
        (t.isStringLiteral(this.#unwrap(node.left)) || t.isStringLiteral(node.right))
      ) {
        return this.#reject(node, 'string-concatenation')
      }
      return this.#reject(node, 'arithmetic-operator', `\`${node.operator}\` is an operator.`)
    }

    if (t.isConditionalExpression(node)) {
      return this.#reject(node, 'ternary-in-attribute', 'A ternary cannot produce a value here.')
    }

    return this.#reject(node, 'schema-rejected', `\`${node.type}\` has no AST equivalent.`)
  }

  #classifyCall(node: t.CallExpression): null {
    const callee = this.#unwrap(node.callee)

    if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property)) {
      const method = callee.property.name
      if (
        method === 'createElement' &&
        t.isIdentifier(callee.object) &&
        callee.object.name === 'React'
      ) {
        return this.#reject(node, 'create-element')
      }
      if (method === 'map') {
        return this.#reject(node, 'function-call', '`.map()` may only appear as a child.')
      }
      if (ARRAY_METHODS.has(method)) {
        return this.#reject(node, 'array-method', `\`.${method}()\` runs a function.`)
      }
      if (t.isIdentifier(callee.object) && callee.object.name === FILTER_NAMESPACE) {
        return this.#reject(node, 'unknown-filter', `\`f.${method}\` is not a filter.`)
      }
      return this.#reject(node, 'function-call', `\`.${method}()\` is a call.`)
    }

    const name = t.isIdentifier(callee) ? `\`${callee.name}()\`` : 'This'
    return this.#reject(node, 'function-call', `${name} is a call.`)
  }

  #literal(input: t.Node): AstLiteral | undefined {
    const node = this.#unwrap(input)
    if (t.isStringLiteral(node)) return node.value
    if (t.isNumericLiteral(node)) return node.value
    if (t.isBooleanLiteral(node)) return node.value
    if (t.isNullLiteral(node)) return null
    // A template literal with nothing to substitute is a string spelled with
    // backticks, and refusing it would be pedantry rather than safety.
    if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
      return node.quasis[0]?.value.cooked ?? ''
    }
    if (t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument)) {
      return -node.argument.value
    }
    return undefined
  }

  #segments(input: t.Node): (string | number)[] | null {
    const node = this.#unwrap(input)

    if (t.isIdentifier(node)) {
      const found = this.#lookup(node.name)
      if (found) return [...found]
      if (node.name === FILTER_NAMESPACE) {
        return this.#reject(node, 'unknown-filter', '`f` is the filter namespace, not a value.')
      }
      return this.#reject(node, 'unresolved-identifier', `\`${node.name}\` is not in scope.`)
    }

    if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
      const base = this.#segments(node.object)
      if (!base) return null

      if (node.computed) {
        const property = this.#unwrap(node.property)
        if (t.isStringLiteral(property)) return [...base, property.value]
        if (t.isNumericLiteral(property)) return [...base, property.value]
        return this.#reject(node.property, 'computed-member')
      }
      if (t.isIdentifier(node.property)) return [...base, node.property.name]
      return this.#reject(node.property, 'computed-member')
    }

    if (t.isThisExpression(node)) {
      return this.#reject(node, 'member-expression-root', '`this` has no meaning in a template.')
    }

    return this.#classify(node)
  }

  #path(input: t.Node): AstPath | null {
    const segments = this.#segments(input)
    if (!segments) return null
    if (segments.length === 0) {
      return this.#reject(
        input,
        'member-expression-root',
        'The props object itself is not a value; read a field from it.',
      )
    }

    const candidate: AstPath = { type: 'path', segments }
    const parsed = AstPathSchema.safeParse(candidate)
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'invalid path'
      const code: UnsupportedCode = message.includes('prototype')
        ? 'prototype-path'
        : 'schema-rejected'
      return this.#reject(input, code, message)
    }
    return candidate
  }

  /** A path, or a literal — the only two things `AstExpr` can hold. */
  #expr(input: t.Node): AstExpr | null {
    const literal = this.#literal(input)
    if (literal !== undefined) return { type: 'literal', value: literal }
    if (t.isNullLiteral(this.#unwrap(input))) return { type: 'literal', value: null }
    return this.#path(input)
  }

  /** A path plus the filter chain wrapping it, innermost filter applied first. */
  #filtered(input: t.Node): { expr: AstPath; filters: AstFilter[] } | null {
    const node = this.#unwrap(input)

    if (t.isCallExpression(node)) {
      if (!isFilterCall(node)) return this.#classifyCall(node)

      const callee = this.#unwrap(node.callee) as t.MemberExpression
      const name = (callee.property as t.Identifier).name
      if (this.#lookup(FILTER_NAMESPACE)) {
        return this.#reject(callee, 'reserved-filter-namespace')
      }
      if (!FILTERS.has(name)) {
        return this.#reject(callee, 'unknown-filter', `\`f.${name}\` is not a filter.`)
      }

      const [subject, ...rest] = node.arguments
      if (subject === undefined) {
        return this.#reject(node, 'filter-argument', `\`f.${name}\` needs a value to filter.`)
      }
      if (t.isSpreadElement(subject)) return this.#reject(subject, 'spread-element')

      const inner = this.#filtered(subject as t.Expression)
      if (!inner) return null

      const args: AstLiteral[] = []
      let argsOk = true
      for (const arg of rest) {
        if (t.isSpreadElement(arg)) {
          this.#reject(arg, 'spread-element')
          argsOk = false
          continue
        }
        const literal = this.#literal(arg as t.Node)
        if (literal === undefined) {
          this.#reject(arg as t.Node, 'filter-argument', `Argument to \`f.${name}\`.`)
          argsOk = false
          continue
        }
        args.push(literal)
      }
      if (!argsOk) return null

      return { expr: inner.expr, filters: [...inner.filters, { name: name as FilterName, args }] }
    }

    const path = this.#path(node)
    return path === null ? null : { expr: path, filters: [] }
  }

  // -------------------------------------------------------------------------
  // Conditions
  // -------------------------------------------------------------------------

  #condition(input: t.Node): AstCondition | null {
    const node = this.#unwrap(input)

    if (t.isUnaryExpression(node) && node.operator === '!') {
      const inner = this.#condition(node.argument)
      return inner === null ? null : { type: 'not', condition: inner }
    }

    if (t.isLogicalExpression(node)) {
      if (node.operator === '??') {
        return this.#reject(
          node,
          'logical-value',
          '`??` tests for null rather than truthiness, which the AST cannot express.',
        )
      }
      const type = node.operator === '&&' ? 'and' : 'or'
      const flat: AstCondition[] = []
      const collect = (branch: t.Node): boolean => {
        const unwrapped = this.#unwrap(branch)
        if (t.isLogicalExpression(unwrapped) && unwrapped.operator === node.operator) {
          return collect(unwrapped.left) && collect(unwrapped.right)
        }
        const lowered = this.#condition(unwrapped)
        if (lowered === null) return false
        flat.push(lowered)
        return true
      }
      if (!collect(node.left) || !collect(node.right)) return null
      return { type, conditions: flat }
    }

    if (t.isBinaryExpression(node)) {
      const op = COMPARISONS[node.operator]
      if (op === undefined) return this.#classify(node)
      if (t.isPrivateName(node.left)) return this.#classify(node.left)
      const left = this.#expr(node.left)
      const right = this.#expr(node.right)
      if (!left || !right) return null
      return { type: 'compare', op, left, right }
    }

    const value = this.#expr(node)
    return value === null ? null : { type: 'truthy', value }
  }

  // -------------------------------------------------------------------------
  // Values (attributes and props)
  // -------------------------------------------------------------------------

  #value(input: t.Node, label: string): AstValue | null {
    const node = this.#unwrap(input)

    const literal = this.#literal(node)
    if (literal !== undefined) {
      if (literal === null) return null
      return { type: 'static', value: literal }
    }

    if (t.isConditionalExpression(node)) {
      return this.#reject(node, 'ternary-in-attribute', `In \`${label}\`.`)
    }
    if (t.isLogicalExpression(node)) {
      return this.#reject(node, 'logical-value', `In \`${label}\`.`)
    }

    const filtered = this.#filtered(node)
    if (!filtered) return null
    return filtered.filters.length === 0
      ? { type: 'dynamic', expr: filtered.expr }
      : { type: 'dynamic', expr: filtered.expr, filters: filtered.filters }
  }

  /**
   * `style={{ margin: 0 }}` is serialised here, at compile time, because a
   * literal object is data — but only if every value is literal. The moment
   * one is an expression the object would have to be built at render time,
   * which is the thing the worker does not do.
   */
  #styleObject(node: t.ObjectExpression, label: string): AstValue | null {
    const parts: string[] = []
    let ok = true

    for (const property of node.properties) {
      if (!t.isObjectProperty(property) || property.computed) {
        this.#reject(property, 'dynamic-style-object', `In \`${label}\`.`)
        ok = false
        continue
      }
      const key = t.isIdentifier(property.key)
        ? property.key.name
        : t.isStringLiteral(property.key)
          ? property.key.value
          : null
      const literal = this.#literal(property.value)
      if (key === null || literal === null || literal === undefined) {
        this.#reject(property, 'dynamic-style-object', `In \`${label}\`.`)
        ok = false
        continue
      }
      const css = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
      const value = typeof literal === 'number' && !UNITLESS.has(css) ? `${literal}px` : literal
      parts.push(`${css}:${value}`)
    }

    if (!ok) return null
    return { type: 'static', value: parts.length === 0 ? '' : `${parts.join(';')};` }
  }

  // -------------------------------------------------------------------------
  // JSX
  // -------------------------------------------------------------------------

  #attributes(
    element: t.JSXOpeningElement,
    kind: 'element' | 'component',
  ): Record<string, AstValue> {
    const out: Record<string, AstValue> = {}

    for (const attribute of element.attributes) {
      if (t.isJSXSpreadAttribute(attribute)) {
        this.#reject(attribute, 'spread-attribute')
        continue
      }
      if (t.isJSXNamespacedName(attribute.name)) {
        this.#reject(attribute.name, 'jsx-namespaced-name')
        continue
      }

      const written = attribute.name.name
      if (/^on[A-Z]/.test(written)) {
        this.#reject(attribute, 'event-handler', `\`${written}\`.`)
        continue
      }
      if (written === 'dangerouslySetInnerHTML') {
        this.#reject(attribute, 'dangerous-html')
        continue
      }
      if (written === 'key' || written === 'ref') {
        // React bookkeeping, not content: dropping it silently is right,
        // because it never had a rendered meaning to lose.
        continue
      }

      const name = kind === 'element' ? this.#htmlAttributeName(attribute, written) : written
      if (name === null) continue

      const value = attribute.value
      if (value === null || value === undefined) {
        out[name] = { type: 'static', value: true }
        continue
      }
      if (t.isStringLiteral(value)) {
        out[name] = { type: 'static', value: value.value }
        continue
      }
      if (t.isJSXExpressionContainer(value)) {
        const inner = value.expression
        if (t.isJSXEmptyExpression(inner)) continue
        if (name === 'style' && t.isObjectExpression(this.#unwrap(inner))) {
          const serialised = this.#styleObject(this.#unwrap(inner) as t.ObjectExpression, name)
          if (serialised) out[name] = serialised
          continue
        }
        const lowered = this.#value(inner, name)
        if (lowered) out[name] = lowered
        continue
      }
      this.#reject(value, 'jsx-in-value', `In \`${written}\`.`)
    }

    return out
  }

  /**
   * React's spelling and HTML's differ (`className`, `colSpan`), and the
   * allowlist is HTML's. Rather than keep a second copy of that list, the
   * candidate spellings are probed against the schema in order of preference,
   * so the answer always comes from `@mailysend/templates`.
   */
  #htmlAttributeName(node: t.Node, written: string): string | null {
    const candidates = [ATTRIBUTE_ALIASES[written], written, written.toLowerCase()].filter(
      (name): name is string => name !== undefined,
    )
    for (const candidate of candidates) {
      if (attributeAllowed(candidate)) return candidate
    }
    return this.#reject(node, 'disallowed-attribute', `\`${written}\`.`)
  }

  #children(children: t.JSXElement['children']): AstNode[] {
    const out: AstNode[] = []

    for (const child of children) {
      if (t.isJSXText(child)) {
        const text = cleanJsxText(child.value)
        if (text !== '') out.push({ type: 'text', value: text })
        continue
      }
      if (t.isJSXSpreadChild(child)) {
        this.#reject(child, 'spread-child')
        continue
      }
      if (t.isJSXElement(child) || t.isJSXFragment(child)) {
        out.push(...this.#element(child))
        continue
      }
      if (t.isJSXExpressionContainer(child)) {
        out.push(...this.#container(child.expression))
      }
    }

    return out
  }

  /** The expression inside `{…}` in child position, where the node types live. */
  #container(input: Expression): AstNode[] {
    if (t.isJSXEmptyExpression(input)) return []
    const node = this.#unwrap(input) as t.Expression

    if (t.isJSXElement(node) || t.isJSXFragment(node)) return this.#element(node)

    if (t.isLogicalExpression(node) && node.operator === '&&') {
      const test = this.#condition(node.left)
      const consequent = this.#branch(node.right)
      if (!test || !consequent) return []
      return [{ type: 'conditional', test, consequent }]
    }

    if (t.isLogicalExpression(node)) {
      this.#reject(
        node,
        'logical-value',
        `\`${node.operator}\` picks a value. Write it as \`{cond ? a : b}\`.`,
      )
      return []
    }

    if (t.isConditionalExpression(node)) {
      const test = this.#condition(node.test)
      const consequent = this.#branch(node.consequent)
      const alternate = this.#branch(node.alternate)
      if (!test || !consequent || !alternate) return []
      return alternate.length === 0
        ? [{ type: 'conditional', test, consequent }]
        : [{ type: 'conditional', test, consequent, alternate }]
    }

    // A filter chain is a call in appearance, so it has to be recognised before
    // the call is handed to the loop lowering and refused as "not .map()".
    if (t.isCallExpression(node) && !isFilterCall(node)) {
      const loop = this.#loop(node)
      return loop === null ? [] : [loop]
    }

    const literal = this.#literal(node)
    if (literal !== undefined) {
      // `{null}`, `{false}` and `{undefined}` are React's way of rendering
      // nothing; they are not an error and not a text node saying "null".
      if (literal === null || literal === false) return []
      return [{ type: 'text', value: String(literal) }]
    }
    if (t.isIdentifier(node) && node.name === 'undefined' && !this.#lookup('undefined')) return []

    const filtered = this.#filtered(node)
    if (!filtered) return []
    return [
      filtered.filters.length === 0
        ? { type: 'interpolation', expr: filtered.expr }
        : { type: 'interpolation', expr: filtered.expr, filters: filtered.filters },
    ]
  }

  /** One arm of a conditional: JSX, text, or nothing. */
  #branch(input: t.Node): AstNode[] | null {
    const node = this.#unwrap(input) as t.Expression
    if (t.isNullLiteral(node)) return []
    if (t.isBooleanLiteral(node) && node.value === false) return []
    if (t.isIdentifier(node) && node.name === 'undefined' && !this.#lookup('undefined')) return []

    const before = this.diagnostics.length
    const nodes = this.#container(node)
    return this.diagnostics.length > before ? null : nodes
  }

  #loop(node: t.CallExpression): AstNode | null {
    const callee = this.#unwrap(node.callee)
    const isMap =
      t.isMemberExpression(callee) &&
      !callee.computed &&
      t.isIdentifier(callee.property) &&
      callee.property.name === 'map'

    if (!isMap) return this.#classifyCall(node)

    const source = this.#path((callee as t.MemberExpression).object)
    if (!source) return null

    const [callback, ...extra] = node.arguments
    for (const argument of extra) {
      this.#reject(argument, 'function-call', '`.map()` takes only the callback here.')
    }
    if (
      callback === undefined ||
      (!t.isArrowFunctionExpression(callback) && !t.isFunctionExpression(callback))
    ) {
      return this.#reject(callback ?? node, 'map-callback')
    }

    const [itemParam, indexParam, ...rest] = callback.params
    for (const param of rest) {
      this.#reject(param, 'map-callback', '`.map()` binds at most an item and an index.')
    }

    const names: string[] = []
    for (const param of [itemParam, indexParam]) {
      if (param === undefined) break
      if (!t.isIdentifier(param)) {
        this.#reject(param, 'destructured-loop-param')
        return null
      }
      names.push(param.name)
    }

    const item = names[0] ?? '_item'
    const index = names[1]

    const scope: Scope = new Map()
    scope.set(item, [item])
    if (index !== undefined) scope.set(index, [index])
    this.#push(scope)

    const body = t.isBlockStatement(callback.body)
      ? this.#returnedExpression(callback.body)
      : callback.body
    const lowered = body === null ? null : this.#branch(body)

    this.#pop()
    if (lowered === null) return null

    return index === undefined
      ? { type: 'loop', source, item, body: lowered }
      : { type: 'loop', source, item, index, body: lowered }
  }

  #element(node: t.JSXElement | t.JSXFragment): AstNode[] {
    if (t.isJSXFragment(node)) return this.#children(node.children)

    const opening = node.openingElement
    const name = opening.name

    if (t.isJSXNamespacedName(name)) {
      this.#reject(name, 'jsx-namespaced-name')
      return []
    }

    if (t.isJSXMemberExpression(name)) {
      if (flatMemberName(name) === 'React.Fragment') return this.#children(node.children)
      this.#reject(name, 'jsx-member-element', `\`${flatMemberName(name)}\`.`)
      return []
    }

    if (name.name === 'Fragment') return this.#children(node.children)

    const isComponent = /^[A-Z]/.test(name.name)
    const attrs = this.#attributes(opening, isComponent ? 'component' : 'element')
    const children = this.#children(node.children)

    if (isComponent) {
      if (!COMPONENT_NAMES.has(name.name)) {
        this.#reject(name, 'unknown-component', `\`<${name.name}>\` is not a component.`)
        return []
      }
      const built: AstNode = { type: 'component', name: name.name as ComponentName }
      if (Object.keys(attrs).length > 0) built.props = attrs
      if (children.length > 0) built.children = children
      return this.#accept(name, built)
    }

    const built: AstNode = { type: 'element', tag: name.name }
    if (Object.keys(attrs).length > 0) built.attrs = attrs
    if (children.length > 0) built.children = children
    return this.#accept(name, built)
  }

  /**
   * The single point where a built node meets the schema. Children are
   * replaced with an empty list first: they were validated when they were
   * built, and re-validating them here would report one nested mistake once
   * per level of nesting.
   */
  #accept(at: t.Node, node: AstNode): AstNode[] {
    const shallow: AstNode =
      node.type === 'element' || node.type === 'component'
        ? ({ ...node, children: [] } as AstNode)
        : node
    const parsed = AstNodeSchema.safeParse(shallow)
    if (parsed.success) return [node]

    for (const issue of parsed.error.issues) {
      const [head, key] = issue.path
      if (head === 'tag')
        this.#reject(at, 'disallowed-element', `\`<${(node as { tag: string }).tag}>\`.`)
      else if (head === 'name') this.#reject(at, 'unknown-component')
      else if (head === 'attrs' && typeof key === 'string') {
        this.#reject(at, 'disallowed-attribute', `\`${key}\`.`)
      } else this.#reject(at, 'schema-rejected', `${issue.path.join('.')}: ${issue.message}`)
    }
    return []
  }

  // -------------------------------------------------------------------------
  // The component
  // -------------------------------------------------------------------------

  #returnedExpression(block: t.BlockStatement): t.Expression | null {
    const returns = block.body.filter((statement): statement is t.ReturnStatement =>
      t.isReturnStatement(statement),
    )
    for (const statement of block.body) {
      if (t.isReturnStatement(statement)) continue
      // A type alias or interface is erased and cannot affect the output, so
      // refusing it would only make TSX authors delete harmless lines.
      if (t.isTSTypeAliasDeclaration(statement) || t.isTSInterfaceDeclaration(statement)) continue
      this.#reject(statement, 'statement-in-component', `\`${statement.type}\`.`)
    }
    if (returns.length > 1) {
      for (const extra of returns.slice(1)) this.#reject(extra, 'multiple-returns')
      return null
    }
    const only = returns[0]
    if (!only?.argument) {
      this.#reject(only ?? block, 'empty-template')
      return null
    }
    return only.argument
  }

  #propScope(param: t.Node | undefined): Scope {
    const scope: Scope = new Map()
    if (param === undefined) return scope

    if (t.isIdentifier(param)) {
      // `props` addresses the data root, so `props.user.name` is `user.name`.
      scope.set(param.name, [])
      return scope
    }

    if (t.isObjectPattern(param)) {
      this.#pattern(param, [], scope)
      return scope
    }

    if (t.isAssignmentPattern(param)) {
      this.#reject(param, 'destructuring-default')
      return scope
    }

    this.#reject(param, 'not-a-component', 'The props parameter must be a name or a pattern.')
    return scope
  }

  #pattern(pattern: t.ObjectPattern, prefix: (string | number)[], scope: Scope) {
    for (const property of pattern.properties) {
      if (t.isRestElement(property)) {
        this.#reject(property, 'rest-element')
        continue
      }
      if (property.computed) {
        this.#reject(property, 'computed-member')
        continue
      }
      const key = t.isIdentifier(property.key)
        ? property.key.name
        : t.isStringLiteral(property.key)
          ? property.key.value
          : null
      if (key === null) {
        this.#reject(property, 'computed-member')
        continue
      }

      const value = property.value
      if (t.isAssignmentPattern(value)) {
        this.#reject(value, 'destructuring-default', `\`${key}\`.`)
        continue
      }
      if (t.isObjectPattern(value)) {
        this.#pattern(value, [...prefix, key], scope)
        continue
      }
      if (!t.isIdentifier(value)) {
        this.#reject(value, 'destructured-loop-param', `\`${key}\`.`)
        continue
      }
      if (value.name === FILTER_NAMESPACE) {
        this.#reject(value, 'reserved-filter-namespace')
        continue
      }
      scope.set(value.name, [...prefix, key])
    }
  }

  compile(program: t.Program): AstNode[] | null {
    const component = findDefaultComponent(program)
    if (component === null) {
      this.diagnostics.push(diagnostic(this.#source, program, 'no-default-export'))
      return null
    }
    if (component === 'not-a-component') {
      this.diagnostics.push(diagnostic(this.#source, program, 'not-a-component'))
      return null
    }

    this.#push(this.#propScope(component.params[0]))

    const returned = t.isBlockStatement(component.body)
      ? this.#returnedExpression(component.body)
      : component.body
    if (returned === null) {
      this.#pop()
      return null
    }

    const nodes = this.#container(returned as t.Expression)
    this.#pop()
    return nodes
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** CSS properties whose bare number is not a pixel length. */
const UNITLESS = new Set([
  'font-weight',
  'line-height',
  'opacity',
  'order',
  'flex',
  'flex-grow',
  'flex-shrink',
  'z-index',
])

/**
 * The lexical shape `f.<name>(…)`. Whether something is a filter is decided
 * here and nowhere else, so a call can never become a filter by accident of
 * what `f` happens to resolve to.
 */
const isFilterCall = (node: t.Node): boolean => {
  if (!t.isCallExpression(node)) return false
  const callee = node.callee
  return (
    t.isMemberExpression(callee) &&
    !callee.computed &&
    t.isIdentifier(callee.object) &&
    callee.object.name === FILTER_NAMESPACE &&
    t.isIdentifier(callee.property)
  )
}

const attributeAllowed = (name: string): boolean =>
  AstNodeSchema.safeParse({
    type: 'element',
    tag: 'div',
    attrs: { [name]: { type: 'static', value: '' } },
  }).success

const flatMemberName = (name: t.JSXMemberExpression): string => {
  const object = t.isJSXMemberExpression(name.object)
    ? flatMemberName(name.object)
    : name.object.name
  return `${object}.${name.property.name}`
}

/**
 * React's own whitespace rule, reproduced exactly: interior newlines and the
 * indentation that follows them collapse to a single space, and a line that is
 * only whitespace disappears. Getting this wrong shows up as missing or
 * doubled spaces between words in a sentence split across source lines.
 */
export const cleanJsxText = (raw: string): string => {
  const lines = raw.split(/\r\n|\n|\r/)
  let lastNonEmpty = 0
  for (let i = 0; i < lines.length; i++) {
    if (/[^ \t]/.test(lines[i] ?? '')) lastNonEmpty = i
  }

  let out = ''
  for (let i = 0; i < lines.length; i++) {
    let line = (lines[i] ?? '').replace(/\t/g, ' ')
    if (i !== 0) line = line.replace(/^ +/, '')
    if (i !== lines.length - 1) line = line.replace(/ +$/, '')
    if (line === '') continue
    if (i !== lastNonEmpty) line += ' '
    out += line
  }
  return out
}

type ComponentFunction = t.FunctionDeclaration | t.ArrowFunctionExpression | t.FunctionExpression

const asComponent = (node: t.Node | null | undefined): ComponentFunction | null =>
  t.isFunctionDeclaration(node) || t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)
    ? node
    : null

const findDefaultComponent = (program: t.Program): ComponentFunction | null | 'not-a-component' => {
  const exported = program.body.find((node): node is t.ExportDefaultDeclaration =>
    t.isExportDefaultDeclaration(node),
  )
  if (!exported) return null

  const direct = asComponent(exported.declaration)
  if (direct) return direct

  if (!t.isIdentifier(exported.declaration)) return 'not-a-component'

  const name = exported.declaration.name
  for (const statement of program.body) {
    const declaration = t.isExportNamedDeclaration(statement) ? statement.declaration : statement
    if (t.isFunctionDeclaration(declaration) && declaration.id?.name === name) return declaration
    if (t.isVariableDeclaration(declaration)) {
      for (const declarator of declaration.declarations) {
        if (t.isIdentifier(declarator.id) && declarator.id.name === name) {
          const found = asComponent(declarator.init)
          if (found) return found
        }
      }
    }
  }
  return 'not-a-component'
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export const compileJsxToAst = (source: string, options: CompileOptions = {}): CompileResult => {
  let program: t.Program
  try {
    program = parse(source, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: false,
    }).program
  } catch (error) {
    const babel = error as { message?: string; loc?: { line: number; column: number } }
    return {
      ok: false,
      diagnostics: [
        {
          code: 'schema-rejected',
          message: `${options.filename ?? 'input'} could not be parsed: ${babel.message ?? String(error)}`,
          loc: { line: babel.loc?.line ?? 0, column: (babel.loc?.column ?? 0) + 1 },
          excerpt: '',
        },
      ],
    }
  }

  const compiler = new Compiler(source)
  const nodes = compiler.compile(program)

  if (nodes === null || compiler.diagnostics.length > 0) {
    return { ok: false, diagnostics: compiler.diagnostics }
  }
  if (nodes.length === 0) {
    return {
      ok: false,
      diagnostics: [
        {
          code: 'empty-template',
          message: 'The component rendered nothing.',
          loc: { line: 1, column: 1 },
          excerpt: '',
        },
      ],
    }
  }

  // The contract point with the server. The CLI runs `validateAst` on its own
  // output so a compiler bug is caught here rather than at send time, on
  // someone else's mail.
  const document = astDocument(nodes)
  const validated = validateAst(document)
  if (!validated.ok) {
    return {
      ok: false,
      diagnostics: validated.errors.map((issue) => ({
        code: 'schema-rejected' as const,
        message: `${issue.path}: ${issue.message}`,
        loc: { line: 0, column: 0 },
        excerpt: '',
      })),
    }
  }

  return { ok: true, ast: validated.ast, variables: extractAstVariables(validated.ast) }
}
