import { describe, expect, it } from 'vitest'
import { ensureTableLayout, inlineCss } from '../src/inline.ts'

describe('inlineCss', () => {
  it('inlines tag, class and id selectors', () => {
    const { html } = inlineCss(
      '<style>p{color:red}.lead{font-size:20px}#hero{padding:8px}</style>' +
        '<p class="lead" id="hero">Hi</p>',
    )
    expect(html).toContain('color:red')
    expect(html).toContain('font-size:20px')
    expect(html).toContain('padding:8px')
  })

  it('resolves conflicts by specificity, not source order', () => {
    const { html } = inlineCss('<style>.a{color:red}p{color:blue}</style><p class="a">x</p>')
    expect(html).toMatch(/style="[^"]*color:red/)
    expect(html).not.toContain('color:blue')
  })

  it('lets an existing inline declaration win', () => {
    const { html } = inlineCss('<style>#x{color:red}</style><p id="x" style="color:green">y</p>')
    expect(html).toMatch(/style="[^"]*color:green/)
  })

  it('matches descendant combinations only', () => {
    const { html } = inlineCss(
      '<style>.card p{color:red}</style><div class="card"><p>in</p></div><p>out</p>',
    )
    const [inside, outside] = html.split('</div>') as [string, string]
    expect(inside).toContain('color:red')
    expect(outside).not.toContain('color:red')
  })

  it('leaves media queries in the style block', () => {
    const { html } = inlineCss(
      '<style>p{color:red}@media (max-width:600px){p{color:blue}}</style><p>x</p>',
    )
    expect(html).toContain('@media (max-width:600px)')
    expect(html).toContain('color:blue')
    expect(html).toMatch(/<p style="color:red">/)
  })

  it('keeps pseudo-selectors in the block and warns', () => {
    const { html, warnings } = inlineCss('<style>a:hover{color:red}</style><a href="#">x</a>')
    expect(html).toContain('a:hover{color:red}')
    expect(warnings.map((w) => w.code)).toContain('uninlinable_css')
  })

  it('removes the style block when everything was inlined', () => {
    const { html } = inlineCss('<style>p{color:red}</style><p>x</p>')
    expect(html).not.toContain('<style')
  })

  it('ignores markup inside the style block itself', () => {
    const { html } = inlineCss('<style>p:after{content:"<div>"}</style><p>x</p>')
    expect(html).toContain('<p>x</p>')
  })

  it('does nothing when there is no style block', () => {
    const input = '<p style="color:red">x</p>'
    expect(inlineCss(input).html).toBe(input)
  })
})

describe('ensureTableLayout', () => {
  it('stamps the attributes Outlook and screen readers need', () => {
    const html = ensureTableLayout('<table width="600"><tr><td>x</td></tr></table>')
    expect(html).toContain('border="0"')
    expect(html).toContain('cellpadding="0"')
    expect(html).toContain('cellspacing="0"')
    expect(html).toContain('role="presentation"')
    expect(html).toContain('width="600"')
  })

  it('leaves values the author set alone', () => {
    const html = ensureTableLayout('<table cellpadding="8" role="none"><tr><td>x</td></tr></table>')
    expect(html).toContain('cellpadding="8"')
    expect(html).toContain('role="none"')
  })
})
