import { describe, expect, it } from 'vitest'
import { htmlToText, renderTemplate } from '../src/render.ts'

describe('htmlToText', () => {
  it('drops scripts, styles and hidden preheaders', () => {
    const text = htmlToText(
      '<html><head><title>T</title><style>p{color:red}</style></head><body>' +
        '<div style="display:none;max-height:0">Preheader copy</div>' +
        '<script>alert(1)</script><p>Real copy</p></body></html>',
    )
    expect(text).toBe('Real copy')
  })

  it('keeps link destinations alongside the label', () => {
    const text = htmlToText(
      '<p>Read the <a href="https://example.com/post">announcement</a> now.</p>',
    )
    expect(text).toBe('Read the announcement (https://example.com/post) now.')
  })

  it('leaves bare, mailto and anchor links without a duplicate url', () => {
    expect(htmlToText('<a href="https://example.com">https://example.com</a>')).toBe(
      'https://example.com',
    )
    expect(htmlToText('<a href="mailto:jane@example.com">jane@example.com</a>')).toBe(
      'jane@example.com',
    )
    expect(htmlToText('<a href="#top">Back to top</a>')).toBe('Back to top')
  })

  it('converts breaks, paragraphs, headings and lists to newlines', () => {
    const text = htmlToText('<h1>Title</h1><p>One<br>Two</p><ul><li>A</li><li>B</li></ul>')
    expect(text).toBe('Title\n\nOne\nTwo\n\n- A\n- B')
  })

  it('decodes entities and collapses whitespace', () => {
    const text = htmlToText('<p>Ben &amp;   Jerry&rsquo;s   &mdash;\n\n  100&nbsp;% &#8364;5</p>')
    expect(text).toBe('Ben & Jerry’s — 100 % €5')
  })

  it('keeps image alt text', () => {
    expect(htmlToText('<p><img src="a.png" alt="Acme logo"> Welcome</p>')).toBe(
      '[Acme logo] Welcome',
    )
  })

  it('is generated automatically when no text part is supplied', async () => {
    const result = await renderTemplate({
      engine: 'html',
      subject: 'Hi',
      html: '<body><h1>Hello</h1><p>Visit <a href="https://example.com">us</a>.</p></body>',
    })
    expect(result.text).toBe('Hello\n\nVisit us (https://example.com).')
    expect(result.warnings.map((w) => w.code)).toContain('text_generated')
  })

  it('renders an author-supplied text part through the same engine', async () => {
    const result = await renderTemplate({
      engine: 'handlebars',
      subject: 'Hi',
      html: '<p>x</p>',
      text: 'Hi {{name}} & co',
      data: { name: 'Jane' },
    })
    // No HTML escaping in the text part: `&amp;` would be visible to the reader.
    expect(result.text).toBe('Hi Jane & co')
    expect(result.warnings.map((w) => w.code)).not.toContain('text_generated')
  })

  it('can be turned off', async () => {
    const result = await renderTemplate({
      engine: 'html',
      subject: 'Hi',
      html: '<p>hi</p>',
      options: { generateText: false },
    })
    expect(result.text).toBe('')
  })
})
