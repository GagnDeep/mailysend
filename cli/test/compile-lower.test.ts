import { AST_VERSION, renderAst, validateAst } from '@mailysend/templates'
import { describe, expect, it } from 'vitest'
import { cleanJsxText, compileJsxToAst } from '../src/compile/jsx.ts'

const compile = (source: string) => {
  const result = compileJsxToAst(source, { filename: 'test.tsx' })
  if (!result.ok) {
    throw new Error(
      `expected success, got: ${result.diagnostics.map((d) => `${d.code} — ${d.message}`).join('; ')}`,
    )
  }
  return result
}

const nodes = (source: string) => compile(source).ast.nodes

describe('lowering, one case per node type', () => {
  it('lowers JSX text to a text node', () => {
    expect(nodes('export default () => <Text>Hello there</Text>')).toEqual([
      { type: 'component', name: 'Text', children: [{ type: 'text', value: 'Hello there' }] },
    ])
  })

  it('lowers a path expression to an interpolation', () => {
    expect(nodes('export default ({ user }) => <Text>{user.first_name}</Text>')).toEqual([
      {
        type: 'component',
        name: 'Text',
        children: [
          { type: 'interpolation', expr: { type: 'path', segments: ['user', 'first_name'] } },
        ],
      },
    ])
  })

  it('lowers a lowercase tag to an element with attributes', () => {
    expect(nodes('export default ({ u }) => <a href={u.link} class="cta">Open</a>')).toEqual([
      {
        type: 'element',
        tag: 'a',
        attrs: {
          href: { type: 'dynamic', expr: { type: 'path', segments: ['u', 'link'] } },
          class: { type: 'static', value: 'cta' },
        },
        children: [{ type: 'text', value: 'Open' }],
      },
    ])
  })

  it('lowers a capitalised tag to a component with props', () => {
    expect(nodes('export default () => <Container width={600}>x</Container>')).toEqual([
      {
        type: 'component',
        name: 'Container',
        props: { width: { type: 'static', value: 600 } },
        children: [{ type: 'text', value: 'x' }],
      },
    ])
  })

  it('lowers && to a conditional with no alternate', () => {
    const [node] = nodes('export default ({ vip }) => <>{vip && <Text>Hi</Text>}</>')
    expect(node).toMatchObject({
      type: 'conditional',
      test: { type: 'truthy', value: { type: 'path', segments: ['vip'] } },
      consequent: [{ type: 'component', name: 'Text' }],
    })
    expect(node).not.toHaveProperty('alternate')
  })

  it('lowers a ternary to a conditional with both arms', () => {
    expect(nodes('export default ({ p }) => <>{p ? <Text>a</Text> : <Text>b</Text>}</>')).toEqual([
      {
        type: 'conditional',
        test: { type: 'truthy', value: { type: 'path', segments: ['p'] } },
        consequent: [{ type: 'component', name: 'Text', children: [{ type: 'text', value: 'a' }] }],
        alternate: [{ type: 'component', name: 'Text', children: [{ type: 'text', value: 'b' }] }],
      },
    ])
  })

  it('lowers .map to a loop with item and index bindings', () => {
    expect(
      nodes(
        'export default ({ items }) => <>{items.map((item, i) => <Text>{item.name}</Text>)}</>',
      ),
    ).toEqual([
      {
        type: 'loop',
        source: { type: 'path', segments: ['items'] },
        item: 'item',
        index: 'i',
        body: [
          {
            type: 'component',
            name: 'Text',
            children: [
              { type: 'interpolation', expr: { type: 'path', segments: ['item', 'name'] } },
            ],
          },
        ],
      },
    ])
  })

  it('omits the index binding when the callback does not take one', () => {
    const [loop] = nodes('export default ({ xs }) => <>{xs.map((x) => <Text>{x}</Text>)}</>')
    expect(loop).not.toHaveProperty('index')
    expect(loop).toMatchObject({ item: 'x' })
  })

  it('produces a versioned document that renders', () => {
    const { ast } = compile('export default ({ n }) => <Text>Hi {n}</Text>')
    expect(ast.version).toBe(AST_VERSION)
    expect(renderAst(ast, { n: 'Ada' }).html).toContain('Hi Ada')
  })
})

describe('conditions', () => {
  const test = (source: string) => (nodes(source)[0] as { test: unknown }).test

  it('lowers ! to a not', () => {
    expect(test('export default ({ a }) => <>{!a && <Hr/>}</>')).toEqual({
      type: 'not',
      condition: { type: 'truthy', value: { type: 'path', segments: ['a'] } },
    })
  })

  it.each([
    ['===', 'eq'],
    ['!==', 'ne'],
    ['>', 'gt'],
    ['>=', 'gte'],
    ['<', 'lt'],
    ['<=', 'lte'],
  ])('lowers %s to %s', (operator, op) => {
    expect(test(`export default ({ n }) => <>{n ${operator} 3 && <Hr/>}</>`)).toEqual({
      type: 'compare',
      op,
      left: { type: 'path', segments: ['n'] },
      right: { type: 'literal', value: 3 },
    })
  })

  it('flattens chained && into one and', () => {
    expect(test('export default ({ a, b, c }) => <>{a && b && c && <Hr/>}</>')).toMatchObject({
      type: 'and',
      conditions: [{ type: 'truthy' }, { type: 'truthy' }, { type: 'truthy' }],
    })
  })

  it('lowers || to an or', () => {
    expect(test('export default ({ a, b }) => <>{(a || b) && <Hr/>}</>')).toMatchObject({
      type: 'or',
    })
  })
})

describe('filters', () => {
  it('lowers f.<name>(path) to a filter on an interpolation', () => {
    expect(nodes('export default ({ n }) => <Text>{f.upper(n)}</Text>')).toEqual([
      {
        type: 'component',
        name: 'Text',
        children: [
          {
            type: 'interpolation',
            expr: { type: 'path', segments: ['n'] },
            filters: [{ name: 'upper', args: [] }],
          },
        ],
      },
    ])
  })

  it('applies nested filters innermost first', () => {
    const [node] = nodes("export default ({ b }) => <Text>{f.upper(f.truncate(b, 10, '…'))}</Text>")
    expect((node as any).children[0].filters).toEqual([
      { name: 'truncate', args: [10, '…'] },
      { name: 'upper', args: [] },
    ])
  })

  it('lowers a filter in an attribute to a dynamic value', () => {
    const [node] = nodes('export default ({ u }) => <Link href={f.lower(u.url)}>x</Link>')
    expect((node as any).props.href).toEqual({
      type: 'dynamic',
      expr: { type: 'path', segments: ['u', 'url'] },
      filters: [{ name: 'lower', args: [] }],
    })
  })

  it('renders the filtered value rather than the filter call', () => {
    const { ast } = compile('export default ({ n }) => <Text>{f.upper(n)}</Text>')
    const html = renderAst(ast, { n: 'ada' }).html
    expect(html).toContain('ADA')
    expect(html).not.toContain('f.upper')
  })
})

describe('paths and scope', () => {
  it('treats a named props parameter as the data root', () => {
    expect(
      nodes('export default function T(props) { return <Text>{props.a.b}</Text> }'),
    ).toMatchObject([{ children: [{ expr: { segments: ['a', 'b'] } }] }])
  })

  it('resolves nested destructuring to a full path', () => {
    expect(nodes('export default ({ user: { name } }) => <Text>{name}</Text>')).toMatchObject([
      { children: [{ expr: { segments: ['user', 'name'] } }] },
    ])
  })

  it('resolves a renamed prop to its original key', () => {
    expect(nodes('export default ({ user: u }) => <Text>{u.email}</Text>')).toMatchObject([
      { children: [{ expr: { segments: ['user', 'email'] } }] },
    ])
  })

  it('accepts optional chaining, which is the same path', () => {
    expect(nodes('export default ({ u }) => <Text>{u?.name}</Text>')).toMatchObject([
      { children: [{ expr: { segments: ['u', 'name'] } }] },
    ])
  })

  it('accepts a numeric index as a path segment', () => {
    expect(nodes('export default ({ xs }) => <Text>{xs[0].name}</Text>')).toMatchObject([
      { children: [{ expr: { segments: ['xs', 0, 'name'] } }] },
    ])
  })

  it('lets a loop binding shadow a prop of the same name', () => {
    const [loop] = nodes(
      'export default ({ item, items }) => <>{items.map((item) => <Text>{item.x}</Text>)}</>',
    )
    expect((loop as any).body[0].children[0].expr.segments).toEqual(['item', 'x'])
  })

  it('erases TypeScript-only wrappers', () => {
    expect(nodes('export default ({ u }: any) => <Text>{(u.n as string)!}</Text>')).toMatchObject([
      { children: [{ expr: { segments: ['u', 'n'] } }] },
    ])
  })
})

describe('attributes', () => {
  it('renames className to class', () => {
    expect(nodes('export default () => <div className="a">x</div>')).toMatchObject([
      { attrs: { class: { type: 'static', value: 'a' } } },
    ])
  })

  it('lowercases a React attribute spelling that the allowlist has', () => {
    expect(nodes('export default () => <td colSpan={2}>x</td>')).toMatchObject([
      { attrs: { colspan: { type: 'static', value: 2 } } },
    ])
  })

  it('treats a bare attribute as static true', () => {
    expect(nodes('export default () => <Link track>x</Link>')).toMatchObject([
      { props: { track: { type: 'static', value: true } } },
    ])
  })

  it('serialises a literal style object at compile time, with units', () => {
    expect(
      nodes('export default () => <div style={{ marginTop: 4, fontWeight: 600 }}>x</div>'),
    ).toMatchObject([
      { attrs: { style: { type: 'static', value: 'margin-top:4px;font-weight:600;' } } },
    ])
  })

  it('drops React bookkeeping props that have no rendered meaning', () => {
    const [node] = nodes(
      'export default ({ xs }) => <>{xs.map((x) => <Text key={x.id}>{x.n}</Text>)}</>',
    )
    expect((node as any).body[0]).not.toHaveProperty('props')
  })
})

describe('whitespace', () => {
  it('collapses an indented multi-line sentence the way React does', () => {
    expect(cleanJsxText('\n      You have\n      mail\n    ')).toBe('You have mail')
  })

  it('keeps a meaningful single space between an interpolation and text', () => {
    expect(nodes('export default ({ n }) => <Text>Hi {n}, welcome</Text>')).toMatchObject([
      {
        children: [
          { type: 'text', value: 'Hi ' },
          { type: 'interpolation' },
          { type: 'text', value: ', welcome' },
        ],
      },
    ])
  })

  it('drops whitespace-only lines between elements', () => {
    const [node] = nodes(`export default () => (
      <Container>
        <Hr />
        <Hr />
      </Container>
    )`)
    expect((node as any).children).toHaveLength(2)
  })
})

describe('structure', () => {
  it('flattens a fragment into its children', () => {
    expect(nodes('export default () => <><Hr/><Hr/></>')).toHaveLength(2)
  })

  it('renders {null} and {false} as nothing', () => {
    expect(nodes('export default () => <Text>{null}{false}ok</Text>')).toMatchObject([
      { children: [{ type: 'text', value: 'ok' }] },
    ])
  })

  it('skips a JSX comment', () => {
    expect(nodes('export default ({ a }) => <Text>{/* note */}{a}</Text>')).toMatchObject([
      { children: [{ type: 'interpolation' }] },
    ])
  })

  it('follows an identifier default export back to its declaration', () => {
    expect(nodes('function T({ a }) { return <Text>{a}</Text> }\nexport default T')).toHaveLength(1)
  })

  it('omits an alternate that renders nothing', () => {
    const [node] = nodes('export default ({ a }) => <>{a ? <Hr/> : null}</>')
    expect(node).not.toHaveProperty('alternate')
  })
})

describe('variables', () => {
  it('reports prop paths and marks loop bodies against their source', () => {
    const { variables } = compile(
      'export default ({ user, items }) => <><Text>{user.name}</Text>{items.map((i) => <Text>{i.title}</Text>)}</>',
    )
    expect(variables).toEqual(['items', 'items[].title', 'user.name'])
  })

  it('never reports a loop binding as a caller-supplied variable', () => {
    const { variables } = compile(
      'export default ({ xs }) => <>{xs.map((x, n) => <Text>{n}{x.a}</Text>)}</>',
    )
    expect(variables).not.toContain('x')
    expect(variables).not.toContain('n')
  })
})

describe('the contract with the server', () => {
  const sources = [
    'export default () => <Text>plain</Text>',
    'export default ({ a }) => <Text>{a}</Text>',
    'export default ({ a }) => <><Text>{f.capitalize(a)}</Text></>',
    'export default ({ a }) => <>{a && <Hr/>}</>',
    'export default ({ a }) => <>{a ? <Hr/> : <Text>no</Text>}</>',
    'export default ({ xs }) => <ul>{xs.map((x, i) => <li>{x.n}</li>)}</ul>',
    'export default () => <div style={{ padding: 8 }} className="w"><img src="/a.png" alt="a"/></div>',
  ]

  it.each(sources)('validateAst accepts the compiler output for %s', (source) => {
    expect(validateAst(compile(source).ast).ok).toBe(true)
  })

  it('never emits a path as interpolated source text', () => {
    const { ast } = compile('export default ({ user }) => <Text>{user.name}</Text>')
    expect(JSON.stringify(ast)).not.toContain('{user.name}')
    expect(JSON.stringify(ast)).not.toContain('user.name')
  })
})
