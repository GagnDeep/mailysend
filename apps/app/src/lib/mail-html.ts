/**
 * Rendering somebody else's HTML.
 *
 * An inbox displays markup written by whoever felt like sending it. Two things
 * make that safe here, and both are needed:
 *
 *  1. **The frame.** The body renders in an iframe with `sandbox` set but
 *     *without* `allow-same-origin`, so the document sits in an opaque origin.
 *     It cannot reach our DOM, our cookies, our storage or our API even if
 *     everything below fails.
 *  2. **The sanitiser.** An allowlist over a parsed DOM, so nothing gets to the
 *     frame that has any business executing, navigating or phoning home.
 *
 * The original is never modified server-side. It stays in object storage
 * exactly as it arrived, which is what makes the "HTML source" and "raw .eml"
 * tabs worth having — and what lets this file be made stricter later without
 * having destroyed anything.
 */

const ALLOWED_TAGS = new Set([
  'a',
  'abbr',
  'address',
  'area',
  'article',
  'aside',
  'b',
  'bdi',
  'bdo',
  'blockquote',
  'br',
  'caption',
  'center',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'font',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'label',
  'legend',
  'li',
  'main',
  'map',
  'mark',
  'nav',
  'ol',
  'p',
  'pre',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'section',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'tt',
  'u',
  'ul',
  'var',
  'wbr',
  'style',
])

/**
 * Dropped with their contents, not merely unwrapped.
 *
 * `<style>` is the exception in the other direction — it is kept, because an
 * email without its stylesheet is not the email that was sent — and its text is
 * filtered separately.
 */
const DROP_WITH_CONTENT = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'link',
  'base',
  'meta',
  'frame',
  'frameset',
  'noscript',
  'template',
  'svg',
  'math',
  'portal',
])

const ALLOWED_ATTRS = new Set([
  'href',
  'src',
  'alt',
  'title',
  'width',
  'height',
  'align',
  'valign',
  'bgcolor',
  'background',
  'border',
  'cellpadding',
  'cellspacing',
  'colspan',
  'rowspan',
  'color',
  'face',
  'size',
  'dir',
  'lang',
  'style',
  'class',
  'id',
  'target',
  'rel',
  'datetime',
  'cite',
  'start',
  'type',
  'role',
  'abbr',
  'headers',
  'scope',
])

const URL_ATTRS = new Set(['href', 'src', 'background', 'cite'])

/** Anything not on this list cannot appear in an `href` or `src`. */
const SAFE_SCHEMES = /^(https?:|mailto:|tel:|cid:|data:image\/(png|jpe?g|gif|webp|bmp);base64,)/i

export interface SanitizeOptions {
  /** Remote images stay blocked until the reader asks for them. */
  allowRemoteImages?: boolean
  /** `content-id` → a `blob:` URL the parent already fetched. */
  cidMap?: Record<string, string>
}

export interface SanitizeResult {
  html: string
  /** How many remote images were withheld — the "Show images" bar's number. */
  blockedImages: number
  /** True when the message tried to load anything from another origin at all. */
  hasRemoteContent: boolean
}

/**
 * The 1×1 that replaces a blocked image.
 *
 * A transparent pixel rather than `display:none`, because collapsing the layout
 * makes a newsletter unreadable in a way that looks like our bug rather than a
 * deliberate privacy default.
 */
const BLOCKED_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

export function sanitizeMailHtml(html: string, options: SanitizeOptions = {}): SanitizeResult {
  let blockedImages = 0
  let hasRemoteContent = false

  const doc = new DOMParser().parseFromString(html, 'text/html')

  // The parser puts a message's <style> in <head>, and only the body is
  // rendered — so a stylesheet left where the parser filed it would silently
  // disappear and every newsletter would arrive unstyled. Hoisted first, then
  // sanitised with everything else.
  for (const style of [...doc.head.querySelectorAll('style')]) {
    doc.body.insertBefore(style, doc.body.firstChild)
  }

  for (const element of [...doc.querySelectorAll('*')]) {
    const tag = element.tagName.toLowerCase()

    // The parser always builds html/head/body, whatever the fragment was.
    // Unwrapping the document element is both meaningless and a DOM error, and
    // only `doc.body.innerHTML` is returned anyway.
    if (tag === 'html' || tag === 'head' || tag === 'body') continue

    if (DROP_WITH_CONTENT.has(tag)) {
      element.remove()
      continue
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // Unknown but harmless — a custom element, an `<o:p>` from Word. Keep the
      // text, drop the wrapper, rather than deleting content we do not
      // understand.
      element.replaceWith(...element.childNodes)
      continue
    }

    if (tag === 'style') {
      element.textContent = sanitizeCss(element.textContent ?? '')
      continue
    }

    for (const attr of [...element.attributes]) {
      const name = attr.name.toLowerCase()

      // Every event handler, in one rule. `on*` is the whole surface.
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
        element.removeAttribute(attr.name)
        continue
      }
      if (!ALLOWED_ATTRS.has(name)) {
        element.removeAttribute(attr.name)
        continue
      }
      if (name === 'style') {
        element.setAttribute('style', sanitizeCss(attr.value, { inline: true }))
        continue
      }
      if (!URL_ATTRS.has(name)) continue

      const value = attr.value.trim()
      if (!SAFE_SCHEMES.test(value)) {
        // `javascript:`, `vbscript:`, `data:text/html` and every protocol-less
        // oddity land here.
        element.removeAttribute(attr.name)
        continue
      }

      if (value.toLowerCase().startsWith('cid:')) {
        const resolved = options.cidMap?.[value.slice(4).replace(/^<|>$/g, '')]
        if (resolved) element.setAttribute(attr.name, resolved)
        else element.removeAttribute(attr.name)
        continue
      }

      if (name === 'src' || name === 'background') {
        if (/^https?:/i.test(value)) {
          hasRemoteContent = true
          if (!options.allowRemoteImages) {
            blockedImages++
            element.setAttribute(name, BLOCKED_PIXEL)
            element.setAttribute('data-ms-blocked-src', value)
          }
        }
      }
    }

    if (tag === 'a') {
      // A link inside an opaque-origin frame has no useful default target, and
      // `noopener noreferrer` is the correct posture for a link a stranger sent.
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noopener noreferrer nofollow')
    }
  }

  return { html: doc.body.innerHTML, blockedImages, hasRemoteContent }
}

/**
 * CSS is filtered rather than dropped.
 *
 * `@import` fetches from another origin, `position: fixed` escapes the flow of
 * the frame, `expression()` executes on old engines, and `url(http…)` is a
 * tracking pixel wearing a stylesheet. Everything else is presentation and is
 * exactly what the sender meant.
 */
export function sanitizeCss(css: string, options: { inline?: boolean } = {}): string {
  let out = css
    .replace(/@import[^;]+;?/gi, '')
    .replace(/expression\s*\(/gi, 'x(')
    .replace(/behavior\s*:[^;]+;?/gi, '')
    .replace(/-moz-binding[^;]+;?/gi, '')
    .replace(/position\s*:\s*fixed/gi, 'position:static')
    .replace(/url\(\s*['"]?\s*javascript:[^)]*\)/gi, 'none')
  if (!options.inline) out = out.replace(/<\/?\w[^>]*>/g, '')
  return out
}

/**
 * The document handed to the frame.
 *
 * The CSP meta is the second lock on remote content: the sanitiser rewrote the
 * attributes, and this stops anything the sanitiser did not think of from
 * reaching the network. `default-src 'none'` means a stylesheet, a font, a
 * fetch or a websocket the parser did not surface still cannot load.
 */
export function mailFrameDocument(
  bodyHtml: string,
  options: { allowRemoteImages?: boolean; dark?: boolean } = {},
): string {
  const imgSrc = options.allowRemoteImages
    ? 'img-src data: blob: https: http:'
    : 'img-src data: blob:'
  return `<!doctype html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${imgSrc}; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'">
<style>
  html,body{margin:0;padding:16px;background:${options.dark ? '#111' : '#fff'};color:${options.dark ? '#e8e8e8' : '#111'};
    font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    word-break:break-word;overflow-wrap:anywhere}
  img{max-width:100%;height:auto}
  table{max-width:100%}
  a{color:${options.dark ? '#8ab4f8' : '#1a56db'}}
  blockquote{margin:0 0 0 12px;padding-left:12px;border-left:2px solid ${options.dark ? '#333' : '#e3e3e3'};color:${options.dark ? '#aaa' : '#555'}}
</style>
</head><body>${bodyHtml}
<script>
// The only script in the frame, and the only reason allow-scripts is set:
// the parent cannot measure a cross-origin document, so the document reports
// its own height. It touches nothing else.
(function(){
  var send=function(){parent.postMessage({type:'ms-mail-height',height:document.documentElement.scrollHeight},'*')}
  window.addEventListener('load',send);new ResizeObserver(send).observe(document.body);send()
})()
</script>
</body></html>`
}

/** Plain text rendered as HTML: escaped, with bare URLs made clickable. */
export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const linked = escaped.replace(
    /\bhttps?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>`,
  )
  return `<pre style="white-space:pre-wrap;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0">${linked}</pre>`
}

/**
 * The quoted preamble on a reply.
 *
 * Kept here rather than in the composer because the composer's sanitiser is
 * this file's — quoting a message means embedding HTML somebody else wrote, so
 * it goes through exactly the same allowlist on the way in.
 */
export function quoteForReply(message: {
  from: string
  at: string
  html?: string | null
  text?: string | null
}): string {
  const attribution = `On ${new Date(message.at).toLocaleString()}, ${escapeHtml(message.from)} wrote:`
  const body = message.html
    ? sanitizeMailHtml(message.html, { allowRemoteImages: true }).html
    : textToHtml(message.text ?? '')
  return `<br><br><div class="ms-quote"><p>${attribution}</p><blockquote>${body}</blockquote></div>`
}

export const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
