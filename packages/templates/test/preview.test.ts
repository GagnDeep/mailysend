import { describe, expect, it } from 'vitest'
import { astDocument } from '../src/ast.ts'
import { extractVariables, generatePreviewData } from '../src/preview.ts'
import { renderTemplate } from '../src/render.ts'

describe('extractVariables', () => {
  it('finds dotted paths across the subject, body and text part', () => {
    const variables = extractVariables({
      engine: 'handlebars',
      subject: 'Hi {{user.first_name}}',
      html: '<p>{{upper company.name}} owes {{total}}</p>',
      text: 'Bye {{user.last_name}}',
    })
    expect(variables).toEqual(['company.name', 'total', 'user.first_name', 'user.last_name'])
  })

  it('marks loop bodies as repeating and skips block params', () => {
    const variables = extractVariables({
      engine: 'handlebars',
      html: '{{#each order.items as |line|}}<p>{{line.name}}{{this.sku}}</p>{{/each}}',
    })
    expect(variables).toContain('order.items')
    expect(variables).toContain('order.items[].sku')
    expect(variables).not.toContain('line')
  })

  it('resolves paths through a with block', () => {
    expect(
      extractVariables({ engine: 'handlebars', html: '{{#with user}}{{name}}{{/with}}' }),
    ).toEqual(['user', 'user.name'])
  })

  it('does not report helper names as variables', () => {
    const variables = extractVariables({
      engine: 'handlebars',
      html: '{{formatDate created_at "short"}}',
    })
    expect(variables).toEqual(['created_at'])
  })

  it('walks a jsx-ast document', () => {
    const variables = extractVariables({
      engine: 'jsx-ast',
      subject: 'Order {{order.id}}',
      ast: astDocument([
        {
          type: 'conditional',
          test: { type: 'truthy', value: { type: 'path', segments: ['user', 'premium'] } },
          consequent: [
            { type: 'interpolation', expr: { type: 'path', segments: ['user', 'first_name'] } },
          ],
        },
        {
          type: 'loop',
          source: { type: 'path', segments: ['order', 'items'] },
          item: 'line',
          index: 'i',
          body: [
            {
              type: 'component',
              name: 'Img',
              props: {
                src: { type: 'dynamic', expr: { type: 'path', segments: ['line', 'image_url'] } },
              },
            },
          ],
        },
      ]),
    })
    expect(variables).toEqual([
      'order.id',
      'order.items',
      'order.items[].image_url',
      'user.first_name',
      'user.premium',
    ])
  })

  it('reports nothing for the raw html engine beyond the subject', () => {
    expect(
      extractVariables({ engine: 'html', subject: 'Hi {{name}}', html: '<p>{{other}}</p>' }),
    ).toEqual(['name'])
  })
})

describe('generatePreviewData', () => {
  it('produces plausible values keyed off the field name', () => {
    const data = generatePreviewData([
      'user.first_name',
      'user.email',
      'order.total',
      'is_trial',
      'logo_url',
    ])
    expect(data).toMatchObject({
      user: { first_name: 'Jane', email: 'jane@example.com' },
      order: { total: 49.99 },
      is_trial: true,
      logo_url: 'https://example.com/image.png',
    })
  })

  it('expands a repeating path into several entries', () => {
    const data = generatePreviewData(['items[].name', 'items[].price'])
    const items = data.items as { name: string; price: number }[]
    expect(items).toHaveLength(3)
    expect(items[0]?.price).toBe(49.99)
    expect(items[0]?.name).not.toBe(items[1]?.name)
  })

  it('falls back to a readable placeholder for unknown fields', () => {
    expect(generatePreviewData(['favourite_colour'])).toEqual({
      favourite_colour: 'Sample favourite colour',
    })
  })

  it('fills a preview so the render is never blank', async () => {
    const html = '<p>Hi {{user.first_name}}</p>{{#each items}}<li>{{name}}</li>{{/each}}'
    const variables = extractVariables({ engine: 'handlebars', html })
    const result = await renderTemplate({
      engine: 'handlebars',
      subject: 'Preview',
      html,
      data: generatePreviewData(variables),
    })
    expect(result.html).toContain('Hi Jane')
    expect(result.html.match(/<li>/g)).toHaveLength(3)
    expect(result.warnings.filter((w) => w.code === 'missing_variable')).toHaveLength(0)
  })
})
