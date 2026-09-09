import { describe, expect, it } from 'vitest'
import { astDocument, validateAst } from '../src/ast.ts'
import { renderTemplate } from '../src/render.ts'

const XSS = '<script>alert("pwned")</script>'

describe('escaping', () => {
  it('escapes a script tag arriving through contact data', async () => {
    const result = await renderTemplate({
      engine: 'handlebars',
      subject: 'Hi',
      html: '<p>Hello {{first_name}}</p>',
      data: { first_name: XSS },
    })
    expect(result.html).not.toContain('<script>')
    expect(result.html).toContain('&lt;script&gt;')
  })

  it('escapes triple-stash output too, and says so', async () => {
    const result = await renderTemplate({
      engine: 'handlebars',
      subject: 'Hi',
      html: '<p>{{{bio}}}</p>',
      data: { bio: XSS },
    })
    expect(result.html).not.toContain('<script>')
    expect(result.warnings.map((w) => w.code)).toContain('raw_output_escaped')
  })

  it('cannot break out of an attribute value', async () => {
    const result = await renderTemplate({
      engine: 'handlebars',
      subject: 'Hi',
      html: '<img src="{{avatar}}" alt="a">',
      data: { avatar: '" onerror="alert(1)' },
    })
    expect(result.html).not.toContain('onerror="alert(1)"')
    expect(result.html).toContain('&quot;')
  })

  it('drops a javascript: url from the link helper', async () => {
    const result = await renderTemplate({
      engine: 'handlebars',
      subject: 'Hi',
      html: '{{link target "Click"}}',
      data: { target: 'javascript:alert(1)' },
    })
    expect(result.html).toBe('')
    expect(result.warnings.map((w) => w.code)).toContain('unsafe_url')
  })

  it('does not resolve prototype properties', async () => {
    const result = await renderTemplate({
      engine: 'handlebars',
      subject: 'Hi',
      html: '<p>{{a.constructor}}|{{a.__proto__.x}}</p>',
      data: { a: {} },
    })
    expect(result.html).toBe('<p>|</p>')
  })

  it('escapes interpolated data in the AST engine', async () => {
    const result = await renderTemplate({
      engine: 'jsx-ast',
      subject: 'Hi',
      ast: astDocument([
        {
          type: 'component',
          name: 'Text',
          children: [{ type: 'interpolation', expr: { type: 'path', segments: ['bio'] } }],
        },
      ]),
      data: { bio: XSS },
    })
    expect(result.html).not.toContain('<script>')
    expect(result.html).toContain('&lt;script&gt;')
  })

  it('drops a javascript: href supplied as AST data', async () => {
    const result = await renderTemplate({
      engine: 'jsx-ast',
      subject: 'Hi',
      ast: astDocument([
        {
          type: 'element',
          tag: 'a',
          attrs: { href: { type: 'dynamic', expr: { type: 'path', segments: ['target'] } } },
          children: [{ type: 'text', value: 'Click' }],
        },
      ]),
      data: { target: 'java\tscript:alert(1)' },
    })
    expect(result.html).toBe('<a>Click</a>')
    expect(result.warnings.map((w) => w.code)).toContain('unsafe_url')
  })
})

describe('validateAst', () => {
  it('accepts a well-formed document', () => {
    const result = validateAst(astDocument([{ type: 'text', value: 'hi' }]))
    expect(result.ok).toBe(true)
  })

  it('rejects a script element', () => {
    const result = validateAst({
      version: 1,
      nodes: [{ type: 'element', tag: 'script', children: [{ type: 'text', value: 'alert(1)' }] }],
    })
    expect(result.ok).toBe(false)
  })

  it('rejects an event-handler attribute', () => {
    const result = validateAst({
      version: 1,
      nodes: [
        { type: 'element', tag: 'div', attrs: { onclick: { type: 'static', value: 'alert(1)' } } },
      ],
    })
    expect(result.ok).toBe(false)
  })

  it('rejects prototype access in a path expression', () => {
    const result = validateAst({
      version: 1,
      nodes: [
        { type: 'interpolation', expr: { type: 'path', segments: ['user', '__proto__', 'x'] } },
      ],
    })
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown node type and an unknown component', () => {
    expect(validateAst({ version: 1, nodes: [{ type: 'eval', code: '1+1' }] }).ok).toBe(false)
    expect(validateAst({ version: 1, nodes: [{ type: 'component', name: 'Script' }] }).ok).toBe(
      false,
    )
  })

  it('rejects a call-shaped expression, which the grammar has no room for', () => {
    const result = validateAst({
      version: 1,
      nodes: [{ type: 'interpolation', expr: { type: 'call', callee: 'fetch', args: [] } }],
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors.length).toBeGreaterThan(0)
  })

  it('rejects a document with the wrong version', () => {
    expect(validateAst({ version: 99, nodes: [] }).ok).toBe(false)
  })
})
