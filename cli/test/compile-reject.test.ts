// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the fixtures below
// are JSX source text, so a `${…}` inside one is the construct under test.
import { describe, expect, it } from 'vitest'
import { UNSUPPORTED, type UnsupportedCode } from '../src/compile/diagnostics.ts'
import { compileJsxToAst } from '../src/compile/jsx.ts'

const reject = (source: string) => {
  const result = compileJsxToAst(source, { filename: 'test.tsx' })
  if (result.ok) throw new Error(`expected a rejection, got a compiled AST for:\n${source}`)
  return result.diagnostics
}

const codes = (source: string) => reject(source).map((d) => d.code)

/**
 * One case per named construct. The assertion is deliberately on the *code*
 * rather than on prose: the code is what the README documents and what a user
 * greps for, so renaming one has to break a test.
 */
const CASES: [UnsupportedCode, string][] = [
  ['function-call', 'export default ({ o }) => <Text>{formatDate(o.at)}</Text>'],
  ['unknown-filter', 'export default ({ a }) => <Text>{f.shout(a)}</Text>'],
  ['filter-argument', 'export default ({ a, b }) => <Text>{f.truncate(a, b)}</Text>'],
  ['reserved-filter-namespace', 'export default ({ f }) => <Text>{f}</Text>'],
  ['create-element', "export default () => <Text>{React.createElement('a')}</Text>"],
  ['template-literal', 'export default ({ a }) => <Text>{`hi ${a}`}</Text>'],
  ['tagged-template', 'export default ({ a }) => <Text>{tag`x${a}`}</Text>'],
  ['arithmetic-operator', 'export default ({ n }) => <Text>{n * 2}</Text>'],
  ['string-concatenation', "export default ({ a }) => <Text>{'Hi ' + a}</Text>"],
  ['logical-value', 'export default ({ a, b }) => <Link href={a && b}>x</Link>'],
  ['ternary-in-attribute', "export default ({ a }) => <Link href={a ? 'x' : 'y'}>x</Link>"],
  ['unary-operator', 'export default ({ n }) => <Text>{-n}</Text>'],
  ['typeof-operator', 'export default ({ a }) => <Text>{typeof a}</Text>'],
  ['instanceof-operator', 'export default ({ a }) => <>{a instanceof Date && <Hr/>}</>'],
  ['sequence-expression', 'export default ({ a, b }) => <Text>{(a, b)}</Text>'],
  ['assignment', 'export default ({ a }) => <Text>{(a.x = 1)}</Text>'],
  ['update-expression', 'export default ({ a }) => <Text>{a.x++}</Text>'],
  ['new-expression', 'export default () => <Text>{new Date()}</Text>'],
  ['await-expression', 'export default async ({ p }) => <Text>{await p}</Text>'],
  ['optional-call', 'export default ({ o }) => <Text>{o.fn?.()}</Text>'],
  ['spread-attribute', 'export default ({ p }) => <Text {...p}>x</Text>'],
  ['spread-child', 'export default ({ p }) => <Text>{...p}</Text>'],
  ['spread-element', 'export default ({ a, r }) => <Text>{f.default(a, ...r)}</Text>'],
  ['computed-member', 'export default ({ o, k }) => <Text>{o[k]}</Text>'],
  ['member-expression-root', 'export default function T(props) { return <Text>{props}</Text> }'],
  ['prototype-path', 'export default ({ o }) => <Text>{o.__proto__}</Text>'],
  ['unresolved-identifier', 'export default () => <Text>{mystery.name}</Text>'],
  ['array-method', 'export default ({ xs }) => <>{xs.filter(Boolean)}</>'],
  ['map-callback', 'export default ({ xs, fn }) => <>{xs.map(fn)}</>'],
  [
    'destructured-loop-param',
    'export default ({ xs }) => <>{xs.map(({ n }) => <Text>{n}</Text>)}</>',
  ],
  ['function-expression', 'export default ({ a }) => <Link href={() => a}>x</Link>'],
  ['event-handler', 'export default () => <Link onClick={1}>x</Link>'],
  ['dangerous-html', 'export default ({ h }) => <div dangerouslySetInnerHTML={{ __html: h }} />'],
  ['unknown-component', 'export default () => <Sparkle>x</Sparkle>'],
  ['disallowed-element', 'export default () => <script>x</script>'],
  ['disallowed-attribute', 'export default () => <div contenteditable="true">x</div>'],
  ['dynamic-style-object', 'export default ({ c }) => <div style={{ color: c }}>x</div>'],
  ['object-value', 'export default () => <Text>{{ x: 1 }}</Text>'],
  ['array-value', 'export default () => <Text>{[1, 2]}</Text>'],
  ['regexp-literal', 'export default () => <Text>{/x/}</Text>'],
  ['jsx-in-value', 'export default () => <Link href={<Hr/>}>x</Link>'],
  ['jsx-namespaced-name', 'export default () => <svg:rect />'],
  ['jsx-member-element', 'export default () => <Foo.Bar>x</Foo.Bar>'],
  [
    'statement-in-component',
    'export default function T({ a }) { const x = 1; return <Text>{a}</Text> }',
  ],
  ['destructuring-default', "export default ({ n = 'x' }) => <Text>{n}</Text>"],
  ['rest-element', 'export default ({ a, ...rest }) => <Text>{a}</Text>'],
  ['no-default-export', 'export function T() { return <Text>x</Text> }'],
  ['not-a-component', 'const T = 1\nexport default T'],
  ['empty-template', 'export default function T() { return null }'],
]

describe('every unsupported construct is refused by name', () => {
  it.each(CASES)('rejects %s', (code, source) => {
    expect(codes(source)).toContain(code)
  })

  it('covers every code in the catalogue that a template can actually contain', () => {
    const covered = new Set(CASES.map(([code]) => code))
    // `multiple-returns` guards unreachable code after a return, and
    // `schema-rejected` is the backstop for a node the schema refuses for a
    // reason the compiler has no specific name for. Neither has a natural
    // hand-written case, and inventing one would test the test.
    const exempt = new Set(['multiple-returns', 'schema-rejected'])
    const missing = Object.keys(UNSUPPORTED).filter(
      (code) => !covered.has(code as UnsupportedCode) && !exempt.has(code),
    )
    expect(missing).toEqual([])
  })
})

describe('diagnostic quality', () => {
  it('names the construct, the place and the source text', () => {
    const source = 'export default ({ o }) => (\n  <Text>{formatDate(o.at)}</Text>\n)'
    const [d] = reject(source)
    expect(d?.code).toBe('function-call')
    expect(d?.loc.line).toBe(2)
    expect(d?.loc.column).toBeGreaterThan(0)
    expect(d?.excerpt).toBe('formatDate(o.at)')
  })

  it('points a rejected call at the filter chain instead', () => {
    const [d] = reject('export default ({ a }) => <Text>{upper(a)}</Text>')
    expect(d?.message).toContain('f.upper')
  })

  it('names the specific array method rather than saying "a call"', () => {
    const [d] = reject('export default ({ xs }) => <>{xs.reduce(f)}</>')
    expect(d?.message).toContain('.reduce()')
  })

  it('names the offending attribute', () => {
    const [d] = reject('export default () => <div tabindex="1">x</div>')
    expect(d?.message).toContain('tabindex')
  })

  it('names the offending component', () => {
    const [d] = reject('export default () => <Sparkle/>')
    expect(d?.message).toContain('Sparkle')
  })

  it('names the unresolved identifier', () => {
    const [d] = reject('export default () => <Text>{mystery}</Text>')
    expect(d?.message).toContain('mystery')
  })

  it('reports a syntax error with a location rather than throwing', () => {
    const result = compileJsxToAst('export default () => <Text>', { filename: 'broken.tsx' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.diagnostics[0]?.message).toContain('broken.tsx')
  })
})

describe('all problems are collected, not just the first', () => {
  it('reports every unsupported construct in one pass', () => {
    const found = codes('export default ({ a }) => <Text>{go(a)} {a + 1} {typeof a}</Text>')
    expect(found).toEqual(['function-call', 'arithmetic-operator', 'typeof-operator'])
  })

  it('reports repeated misuse at each site', () => {
    const found = reject(
      'export default ({ a, b }) => <><Text>{fmt(a)}</Text><Text>{fmt(b)}</Text></>',
    )
    expect(found).toHaveLength(2)
    expect(found[0]?.loc.column).not.toBe(found[1]?.loc.column)
  })
})

describe('a refusal is never a silent fallback', () => {
  const dangerous = [
    'export default ({ a }) => <Text>{formatDate(a)}</Text>',
    'export default ({ a }) => <Text>{`${a}!`}</Text>',
    "export default ({ a }) => <Text>{'x' + a}</Text>",
    'export default ({ o, k }) => <Text>{o[k]}</Text>',
  ]

  it.each(dangerous)('never produces an AST for %s', (source) => {
    expect(compileJsxToAst(source).ok).toBe(false)
  })

  it('does not fall back to a text node carrying the expression source', () => {
    const result = compileJsxToAst('export default ({ a }) => <Text>{fmt(a)}</Text>')
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('"type":"text"')
  })
})
