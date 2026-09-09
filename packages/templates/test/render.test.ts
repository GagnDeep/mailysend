import { describe, expect, it } from 'vitest'
import { type AstNode, astDocument } from '../src/ast.ts'
import { renderTemplate } from '../src/render.ts'

const path = (...segments: (string | number)[]) => ({ type: 'path' as const, segments })

describe('renderTemplate / handlebars', () => {
  it('interpolates and renders block helpers', async () => {
    const result = await renderTemplate({
      engine: 'handlebars',
      subject: 'Hi {{user.first_name}}, {{formatNumber total style="currency" currency="USD"}} due',
      html:
        '<p>{{capitalize greeting}} {{upper user.first_name}}</p>' +
        '{{#if items}}<ul>{{#each items}}<li>{{@index}}:{{this.name}}</li>{{/each}}</ul>{{/if}}' +
        '{{#unless user.premium}}<p>Upgrade</p>{{/unless}}',
      data: {
        greeting: 'hello',
        total: 42,
        user: { first_name: 'Jane', premium: false },
        items: [{ name: 'Widget' }, { name: 'Gadget' }],
      },
    })

    expect(result.subject).toBe('Hi Jane, $42.00 due')
    expect(result.html).toContain('<p>Hello JANE</p>')
    expect(result.html).toContain('<li>0:Widget</li><li>1:Gadget</li>')
    expect(result.html).toContain('<p>Upgrade</p>')
  })

  it('falls back to the root context inside a loop and honours the else branch', async () => {
    const result = await renderTemplate({
      engine: 'handlebars',
      subject: 'x',
      html: '{{#each items}}<b>{{brand}}</b>{{else}}<i>none</i>{{/each}}',
      data: { brand: 'Acme', items: [] },
    })
    expect(result.html).toBe('<i>none</i>')

    const filled = await renderTemplate({
      engine: 'handlebars',
      subject: 'x',
      html: '{{#each items}}<b>{{brand}}</b>{{/each}}',
      data: { brand: 'Acme', items: [1, 2] },
    })
    expect(filled.html).toBe('<b>Acme</b><b>Acme</b>')
  })

  it('warns about a missing variable but still renders', async () => {
    const result = await renderTemplate({
      engine: 'handlebars',
      subject: 'Hello',
      html: '<p>Hi {{first_name}}</p>',
      data: {},
    })
    expect(result.html).toBe('<p>Hi </p>')
    expect(result.warnings.map((w) => w.code)).toContain('missing_variable')
  })

  it('applies the default, truncate and pluralize helpers', async () => {
    const result = await renderTemplate({
      engine: 'handlebars',
      subject: '{{default nickname "friend"}}',
      html: '<p>{{truncate bio 12}} / {{count}} {{pluralize count "file" "files"}}</p>',
      data: { bio: 'a very long biography indeed', count: 1 },
    })
    expect(result.subject).toBe('friend')
    expect(result.html).toBe('<p>a very long… / 1 file</p>')
  })

  it('rejects unknown helpers and partials without throwing', async () => {
    const result = await renderTemplate({
      engine: 'handlebars',
      subject: 's',
      html: '{{> header}}{{lookup a b}}{{#nope}}x{{/nope}}',
      data: {},
    })
    expect(result.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['unsupported_syntax', 'unknown_helper']),
    )
    expect(result.html).toBe('')
  })
})

describe('renderTemplate / html', () => {
  it('passes the body through untouched and flags merge tags', async () => {
    const result = await renderTemplate({
      engine: 'html',
      subject: 'Hi {{name}}',
      html: '<p>{{name}}</p>',
      data: { name: 'Jane' },
    })
    expect(result.subject).toBe('Hi Jane')
    expect(result.html).toBe('<p>{{name}}</p>')
    expect(result.warnings.map((w) => w.code)).toContain('raw_html_placeholders')
  })
})

describe('renderTemplate / jsx-ast', () => {
  const nodes: AstNode[] = [
    {
      type: 'component',
      name: 'Container',
      children: [
        {
          type: 'component',
          name: 'Heading',
          props: { level: { type: 'static', value: 1 } },
          children: [{ type: 'interpolation', expr: path('title') }],
        },
        {
          type: 'conditional',
          test: {
            type: 'compare',
            op: 'gt',
            left: path('order', 'total'),
            right: { type: 'literal', value: 100 },
          },
          consequent: [
            {
              type: 'component',
              name: 'Text',
              children: [{ type: 'text', value: 'Free shipping' }],
            },
          ],
          alternate: [
            {
              type: 'component',
              name: 'Text',
              children: [{ type: 'text', value: 'Standard shipping' }],
            },
          ],
        },
        {
          type: 'loop',
          source: path('order', 'items'),
          item: 'line',
          index: 'i',
          body: [
            {
              type: 'component',
              name: 'Row',
              children: [
                {
                  type: 'component',
                  name: 'Column',
                  children: [
                    {
                      type: 'interpolation',
                      expr: path('line', 'name'),
                      filters: [{ name: 'upper', args: [] }],
                    },
                  ],
                },
              ],
            },
          ],
          empty: [
            { type: 'component', name: 'Text', children: [{ type: 'text', value: 'Empty' }] },
          ],
        },
        {
          type: 'component',
          name: 'Button',
          props: { href: { type: 'dynamic', expr: path('order', 'url') } },
          children: [{ type: 'text', value: 'View order' }],
        },
      ],
    },
  ]

  it('interprets components, conditionals and loops into table-based HTML', async () => {
    const result = await renderTemplate({
      engine: 'jsx-ast',
      subject: 'Order {{order.id}}',
      ast: astDocument(nodes),
      data: {
        title: 'Thanks!',
        order: {
          id: 'A-1',
          total: 150,
          url: 'https://example.com/o/1',
          items: [{ name: 'Widget' }],
        },
      },
    })

    expect(result.subject).toBe('Order A-1')
    expect(result.html).toContain('<h1 style=')
    expect(result.html).toContain('Thanks!')
    expect(result.html).toContain('Free shipping')
    expect(result.html).not.toContain('Standard shipping')
    expect(result.html).toContain('WIDGET')
    expect(result.html).not.toContain('Empty')
    // Layout is tables, not flexbox: Outlook's Word engine ignores flex/grid.
    expect(result.html).toContain('role="presentation"')
    expect(result.html).not.toMatch(/display\s*:\s*flex|display\s*:\s*grid/)
    expect(result.html).toContain('href="https://example.com/o/1"')
  })

  it('renders the empty branch when the loop source is missing', async () => {
    const result = await renderTemplate({
      engine: 'jsx-ast',
      subject: 's',
      ast: astDocument(nodes),
      data: { title: 'T', order: { total: 1 } },
    })
    expect(result.html).toContain('Empty')
    expect(result.html).toContain('Standard shipping')
  })

  it('reports an invalid document instead of rendering it', async () => {
    const result = await renderTemplate({
      engine: 'jsx-ast',
      subject: 's',
      ast: { version: 1, nodes: [{}] },
    })
    expect(result.html).toBe('')
    expect(result.warnings.map((w) => w.code)).toContain('ast_invalid')
  })
})

describe('renderTemplate / warnings', () => {
  it('flags a missing subject and an empty body', async () => {
    const result = await renderTemplate({ engine: 'handlebars', html: '' })
    expect(result.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['subject_missing', 'empty_html']),
    )
  })

  it('flags a body Gmail would clip', async () => {
    const result = await renderTemplate({
      engine: 'html',
      subject: 'Long',
      html: `<p>${'x'.repeat(103_000)}</p>`,
    })
    expect(result.warnings.map((w) => w.code)).toContain('gmail_clipping')
  })

  it('flags an over-long subject', async () => {
    const result = await renderTemplate({
      engine: 'html',
      subject: 'S'.repeat(200),
      html: '<p>hi</p>',
    })
    expect(result.warnings.map((w) => w.code)).toContain('subject_too_long')
  })
})
