// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  mailFrameDocument,
  quoteForReply,
  sanitizeCss,
  sanitizeMailHtml,
  textToHtml,
} from '../src/lib/mail-html.ts'

/**
 * The sanitiser's tests are written as attacks rather than as features.
 *
 * Every case here is something a real sender has actually tried: the point is
 * not that the allowlist has the right entries, it is that a message written to
 * escape the reading pane cannot.
 */

describe('sanitizeMailHtml', () => {
  it('drops scripts entirely, contents and all', () => {
    const { html } = sanitizeMailHtml('<p>hello</p><script>fetch("//evil")</script>')
    expect(html).toContain('hello')
    expect(html).not.toContain('script')
    expect(html).not.toContain('evil')
  })

  it('removes every event handler', () => {
    const { html } = sanitizeMailHtml(
      '<div onclick="steal()" onmouseover="steal()" onerror="steal()">x</div>',
    )
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('onmouseover')
    expect(html).not.toContain('onerror')
    expect(html).toContain('x')
  })

  it('refuses javascript: and data:text/html URLs', () => {
    const { html } = sanitizeMailHtml(
      `<a href="javascript:alert(1)">a</a>
       <a href="JaVaScRiPt:alert(1)">b</a>
       <a href="data:text/html;base64,PHNjcmlwdD4=">c</a>
       <a href="https://example.com/ok">d</a>`,
    )
    expect(html).not.toContain('javascript')
    expect(html).not.toContain('data:text/html')
    expect(html).toContain('https://example.com/ok')
  })

  it('drops <base> and <link>, which redirect every relative URL in the document', () => {
    const { html } = sanitizeMailHtml(
      '<base href="https://evil.example/"><link rel="stylesheet" href="https://evil.example/x.css"><p>body</p>',
    )
    expect(html).not.toContain('base')
    expect(html).not.toContain('evil.example')
    expect(html).toContain('body')
  })

  it('drops iframes, objects and forms', () => {
    const { html } = sanitizeMailHtml(
      '<iframe src="https://evil.example"></iframe><object data="x"></object><form action="https://evil.example"><input name="password"></form>',
    )
    expect(html).not.toContain('iframe')
    expect(html).not.toContain('object')
    expect(html).not.toContain('form')
    expect(html).not.toContain('input')
  })

  it('unwraps an unknown element instead of deleting the words inside it', () => {
    const { html } = sanitizeMailHtml('<o:p>Outlook wrote this</o:p>')
    expect(html).toContain('Outlook wrote this')
    expect(html).not.toContain('o:p')
  })

  it('blocks remote images until asked, and counts them', () => {
    const source = '<img src="https://tracker.example/pixel.gif"><img src="http://other/x.png">'
    const blocked = sanitizeMailHtml(source)
    expect(blocked.blockedImages).toBe(2)
    expect(blocked.hasRemoteContent).toBe(true)
    // The URL survives only in the data attribute, which is what "Show images"
    // needs in order to put it back; the `src` is a transparent pixel.
    expect(blocked.html).not.toContain('<img src="https://tracker.example/pixel.gif"')
    expect(blocked.html).toContain('src="data:image/gif;base64,')
    expect(blocked.html).toContain('data-ms-blocked-src="https://tracker.example/pixel.gif"')

    const allowed = sanitizeMailHtml(source, { allowRemoteImages: true })
    expect(allowed.blockedImages).toBe(0)
    expect(allowed.html).toContain('https://tracker.example/pixel.gif')
  })

  it('resolves cid: against the map, and removes it when there is nothing to resolve', () => {
    const withMap = sanitizeMailHtml('<img src="cid:logo@example">', {
      cidMap: { 'logo@example': 'blob:https://app/abc' },
    })
    expect(withMap.html).toContain('blob:https://app/abc')

    const without = sanitizeMailHtml('<img src="cid:missing@example">')
    expect(without.html).not.toContain('cid:')
  })

  it('gives every link a target and a rel a stranger cannot abuse', () => {
    const { html } = sanitizeMailHtml('<a href="https://example.com">x</a>')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
  })

  it('keeps the stylesheet but not the parts of it that reach out or escape', () => {
    const { html } = sanitizeMailHtml(
      `<style>@import url("https://evil.example/x.css"); .a{color:red} .b{position:fixed;top:0} .c{width:expression(alert(1))}</style><p class="a">x</p>`,
    )
    expect(html).not.toContain('@import')
    expect(html).not.toContain('evil.example')
    expect(html).not.toContain('position:fixed')
    expect(html).not.toContain('expression(')
    // The presentation the sender actually meant survives.
    expect(html).toContain('color:red')
  })

  it('filters an inline style the same way as a stylesheet', () => {
    const { html } = sanitizeMailHtml(
      '<div style="position:fixed;top:0;color:blue;behavior:url(x.htc)">x</div>',
    )
    expect(html).not.toContain('position:fixed')
    expect(html).not.toContain('behavior')
    expect(html).toContain('color:blue')
  })
})

describe('mailFrameDocument', () => {
  it('carries a CSP that blocks everything the sanitiser might have missed', () => {
    const doc = mailFrameDocument('<p>x</p>')
    expect(doc).toContain("default-src 'none'")
    expect(doc).toContain("form-action 'none'")
    expect(doc).toContain("base-uri 'none'")
    // Remote images are blocked by the policy as well as by the rewrite, so a
    // URL that reached the frame some other way still cannot load.
    expect(doc).toContain('img-src data: blob:;')
  })

  it('opens img-src only once the reader has asked for images', () => {
    expect(mailFrameDocument('<p>x</p>', { allowRemoteImages: true })).toContain(
      'img-src data: blob: https: http:',
    )
  })
})

describe('textToHtml', () => {
  it('escapes markup rather than rendering it', () => {
    const html = textToHtml('<script>alert(1)</script> & "quoted"')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
  })

  it('links bare URLs', () => {
    expect(textToHtml('see https://example.com/x')).toContain('href="https://example.com/x"')
  })
})

describe('quoteForReply', () => {
  it('passes the quoted body through the same allowlist', () => {
    const quoted = quoteForReply({
      from: 'someone@example.com',
      at: '2026-01-01T00:00:00.000Z',
      html: '<p>hi</p><script>alert(1)</script>',
    })
    expect(quoted).toContain('hi')
    expect(quoted).not.toContain('script')
    expect(quoted).toContain('blockquote')
  })

  it('escapes the attribution line, which is attacker-controlled too', () => {
    const quoted = quoteForReply({
      from: '<img src=x onerror=alert(1)>@example.com',
      at: '2026-01-01T00:00:00.000Z',
      text: 'hello',
    })
    // The markup is inert text, not an element: the tag is escaped, so the
    // attribute survives as characters and nothing parses it as an attribute.
    expect(quoted).not.toContain('<img')
    expect(quoted).toContain('&lt;img')
  })
})

describe('sanitizeCss', () => {
  it('cannot be used to close the style element and open a script', () => {
    expect(sanitizeCss('body{}</style><script>alert(1)</script>')).not.toContain('<script')
  })
})
