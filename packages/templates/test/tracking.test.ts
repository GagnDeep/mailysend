import { describe, expect, it, vi } from 'vitest'
import { hasUnsubscribe, injectTracking, injectUnsubscribe } from '../src/tracking.ts'

const rewriter = (url: string, index: number) =>
  `https://t.example.com/c/${index}?u=${encodeURIComponent(url)}`

describe('injectTracking', () => {
  it('rewrites http and https links through the callback', () => {
    const html = injectTracking(
      '<a href="https://example.com/a">a</a><a href="http://example.com/b">b</a>',
      {
        linkRewriter: rewriter,
      },
    )
    expect(html).toContain('https://t.example.com/c/0?u=https%3A%2F%2Fexample.com%2Fa')
    expect(html).toContain('https://t.example.com/c/1?u=http%3A%2F%2Fexample.com%2Fb')
  })

  it('skips mailto, tel, fragment and opted-out links', () => {
    const input =
      '<a href="mailto:jane@example.com">m</a>' +
      '<a href="tel:+61400000000">t</a>' +
      '<a href="#top">f</a>' +
      '<a href="https://example.com/u" data-ms-no-track>u</a>'
    expect(injectTracking(input, { linkRewriter: rewriter })).toBe(input)
  })

  it('skips links whose destination is still a placeholder', () => {
    const input = '<a href="{{unsubscribe_url}}">unsubscribe</a>'
    expect(injectTracking(input, { linkRewriter: rewriter })).toBe(input)
  })

  it('preserves the other attributes on the anchor', () => {
    const html = injectTracking(
      '<a class="btn" href="https://example.com" style="color:red">x</a>',
      {
        linkRewriter: () => 'https://t.example.com/1',
      },
    )
    expect(html).toContain('class="btn"')
    expect(html).toContain('style="color:red"')
    expect(html).toContain('href="https://t.example.com/1"')
  })

  it('leaves a link alone when the rewriter returns it unchanged', () => {
    const input = '<a href="https://example.com">x</a>'
    expect(injectTracking(input, { linkRewriter: (url) => url })).toBe(input)
  })

  it('escapes ampersands in the rewritten url', () => {
    const html = injectTracking('<a href="https://example.com">x</a>', {
      linkRewriter: () => 'https://t.example.com/c?a=1&b=2',
    })
    expect(html).toContain('href="https://t.example.com/c?a=1&amp;b=2"')
  })

  it('appends the pixel immediately before </body>', () => {
    const html = injectTracking('<body><p>hi</p></body>', {
      pixelUrl: 'https://t.example.com/o/abc.gif',
    })
    expect(html).toMatch(/<img src="https:\/\/t\.example\.com\/o\/abc\.gif"[^>]*\/><\/body>$/)
    expect(html).toContain('width="1"')
  })

  it('appends the pixel at the end when there is no body element', () => {
    const html = injectTracking('<p>hi</p>', { pixelUrl: 'https://t.example.com/o/abc.gif' })
    expect(html.endsWith('/>')).toBe(true)
    expect(html.startsWith('<p>hi</p>')).toBe(true)
  })

  it('does nothing when neither option is supplied', () => {
    const input = '<a href="https://example.com">x</a>'
    expect(injectTracking(input, {})).toBe(input)
  })

  it('does not rewrite a link inside a script or style block', () => {
    const spy = vi.fn((url: string) => `https://t/${url}`)
    injectTracking(
      '<style>a{background:url(https://x)}</style><script>var a = "<a href=\'https://y\'>"</script>',
      {
        linkRewriter: spy,
      },
    )
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('injectUnsubscribe', () => {
  const url = 'https://example.com/u/abc?sig=1&t=2'

  it('replaces the handlebars placeholder', () => {
    expect(injectUnsubscribe('<a href="{{unsubscribe_url}}">Stop</a>', { url })).toBe(
      `<a href="${url}">Stop</a>`,
    )
  })

  it('replaces the percent placeholder and the triple-stash spelling', () => {
    expect(injectUnsubscribe('<p>%unsubscribe_url%</p>', { url })).toContain(url)
    expect(injectUnsubscribe('<p>{{{ unsubscribe_url }}}</p>', { url })).toContain(url)
  })

  it('appends a footer when no placeholder is present', () => {
    const html = injectUnsubscribe('<body><p>hi</p></body>', { url })
    expect(html).toContain('Unsubscribe')
    expect(html).toContain('data-ms-no-track')
    expect(html.indexOf('Unsubscribe')).toBeLessThan(html.indexOf('</body>'))
  })

  it('honours a custom footer and the opt-out', () => {
    expect(injectUnsubscribe('<p>hi</p>', { url, footerHtml: '<p>bye</p>' })).toContain(
      '<p>bye</p>',
    )
    expect(injectUnsubscribe('<p>hi</p>', { url, appendFooter: false })).toBe('<p>hi</p>')
  })

  it('does not treat a dollar sign in the url as a replacement token', () => {
    const html = injectUnsubscribe('<a href="{{unsubscribe_url}}">x</a>', {
      url: 'https://e.com/$1?a=$&b',
    })
    expect(html).toContain('https://e.com/$1?a=$&b')
  })
})

describe('hasUnsubscribe', () => {
  it('detects both a placeholder and a plain link', () => {
    expect(hasUnsubscribe('<p>{{unsubscribe_url}}</p>')).toBe(true)
    expect(hasUnsubscribe('<a href="https://e.com/u">Unsubscribe</a>')).toBe(true)
    expect(hasUnsubscribe('<p>hello</p>')).toBe(false)
  })
})
