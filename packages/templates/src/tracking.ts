import { escapeUrlAttr, isSafeUrl, parseAttrs, scanTags } from './html.ts'

/**
 * Post-processing applied by the send path, after rendering.
 *
 * Neither function signs anything. Click tracking requires an HMAC over the
 * destination — otherwise the redirector is an open proxy and every spam
 * filter on earth will treat the sending domain accordingly — but the key and
 * the signing live in `@mailysend/core`, and pulling them in here would make a
 * pure string-to-string module depend on crypto and configuration. So the
 * caller passes a `linkRewriter` and this module stays testable with a
 * one-line stub.
 */

export interface TrackingOptions {
  /**
   * Absolute url of the open pixel. Omit to inject links only — some senders
   * disable open tracking entirely, and since Apple Mail Privacy Protection
   * pre-fetches every pixel, the open rate it produces is mostly fiction.
   */
  pixelUrl?: string
  /**
   * Maps a destination url to the tracked url. Return the input unchanged to
   * leave a link alone. `index` is the zero-based position of the link in the
   * document, which is what a click report groups by when two links share a
   * destination.
   */
  linkRewriter?: (url: string, index: number) => string
}

/** Marks a link that must never be rewritten, e.g. an unsubscribe. */
export const NO_TRACK_ATTRIBUTE = 'data-ms-no-track'

const UNTRACKABLE_SCHEME = /^(mailto:|tel:|sms:|cid:|#)/i

/**
 * Placeholders left for the send path. A link the author has not resolved yet
 * must not be rewritten into the click tracker, or the tracker signs a literal
 * `{{unsubscribe_url}}`.
 */
const UNRESOLVED = /\{\{|\{%|%\w+%|\$\{/

const shouldTrack = (href: string): boolean => {
  const trimmed = href.trim()
  if (trimmed === '') return false
  if (UNTRACKABLE_SCHEME.test(trimmed)) return false
  if (UNRESOLVED.test(trimmed)) return false
  return isSafeUrl(trimmed)
}

export const injectTracking = (html: string, options: TrackingOptions): string => {
  const { pixelUrl, linkRewriter } = options
  let out = html

  if (linkRewriter !== undefined) {
    const edits: { start: number; end: number; text: string }[] = []
    let index = 0
    for (const tag of scanTags(html)) {
      if (tag.name !== 'a' || tag.closing) continue
      const attrs = parseAttrs(tag.attrs)
      const href = attrs.get('href')
      if (href === undefined) continue
      if (attrs.has(NO_TRACK_ATTRIBUTE) || !shouldTrack(href)) continue

      const rewritten = linkRewriter(href, index++)
      if (rewritten === href) continue
      // Only the href value is replaced, so hand-written attributes, MSO
      // conditional junk and inline styles on the anchor survive untouched.
      const text = `<a${tag.attrs.replace(
        /(\shref\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i,
        `$1"${escapeUrlAttr(rewritten).replace(/\$/g, '$$$$')}"`,
      )}>`
      edits.push({ start: tag.start, end: tag.end, text })
    }
    for (const edit of edits.reverse())
      out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  }

  if (pixelUrl !== undefined && pixelUrl !== '') {
    // `width`/`height` attributes as well as the style, because Outlook ignores
    // the style and would otherwise reserve a broken-image placeholder.
    const pixel =
      `<img src="${escapeUrlAttr(pixelUrl)}" width="1" height="1" alt="" border="0" ` +
      'style="display:block;width:1px;height:1px;border:0;outline:none;" />'
    const close = out.toLowerCase().lastIndexOf('</body>')
    out = close === -1 ? out + pixel : out.slice(0, close) + pixel + out.slice(close)
  }

  return out
}

export interface UnsubscribeOptions {
  url: string
  /** Overrides the appended footer. Rendered as-is; the caller owns escaping. */
  footerHtml?: string
  /** Suppresses the appended footer when no placeholder was found. */
  appendFooter?: boolean
}

/**
 * Both spellings are supported because senders migrate: `{{unsubscribe_url}}`
 * is ours and Handlebars-shaped, `%unsubscribe_url%` is the Mailchimp-era one
 * pasted in from an old template.
 */
const PLACEHOLDERS = [
  /\{\{\{?\s*unsubscribe_url\s*\}?\}\}/gi,
  /%unsubscribe_url%/gi,
  /\{\{\{?\s*unsubscribe\s*\}?\}\}/gi,
]

const DEFAULT_FOOTER = (url: string): string =>
  '<div style="margin:24px 0 0;padding:16px 0 0;text-align:center;font-family:' +
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
  'font-size:12px;line-height:18px;color:#6b7280;">' +
  `<a href="${escapeUrlAttr(url)}" ${NO_TRACK_ATTRIBUTE} style="color:#6b7280;text-decoration:underline;">` +
  'Unsubscribe</a></div>'

/**
 * Every bulk message needs a working unsubscribe in the body, not only in the
 * `List-Unsubscribe` header: Gmail and Yahoo's bulk sender rules require one,
 * and a recipient who cannot find it marks the message as spam instead, which
 * costs the sending domain far more than the unsubscribe would have.
 */
export const injectUnsubscribe = (html: string, options: UnsubscribeOptions): string => {
  let out = html
  let replaced = false
  for (const pattern of PLACEHOLDERS) {
    pattern.lastIndex = 0
    if (!pattern.test(out)) continue
    pattern.lastIndex = 0
    // `$` in a url is legal and would otherwise be read as a replacement token.
    out = out.replace(pattern, options.url.replace(/\$/g, '$$$$'))
    replaced = true
  }

  if (replaced || options.appendFooter === false) return out

  const footer = options.footerHtml ?? DEFAULT_FOOTER(options.url)
  const close = out.toLowerCase().lastIndexOf('</body>')
  return close === -1 ? out + footer : out.slice(0, close) + footer + out.slice(close)
}

/** Whether the body already resolves to an unsubscribe, for the pre-send check. */
export const hasUnsubscribe = (html: string): boolean =>
  PLACEHOLDERS.some((pattern) => {
    pattern.lastIndex = 0
    return pattern.test(html)
  }) || /unsubscribe/i.test(html)
