/**
 * HTML primitives shared by the renderers.
 *
 * Deliberately a regex scanner and a stack rather than a real parser: there is
 * no DOM in a Worker, a spec-compliant parser is bundle weight paid on every
 * request, and the inputs are either machine-generated (the AST and MJML
 * engines) or an author's own template body. Where the tradeoff bites —
 * malformed markup, exotic entities — the failure mode is a slightly wrong
 * plain-text part, never an escaping bypass, because every interpolated value
 * is escaped before it is concatenated into markup, not after.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '`': '&#x60;',
  '=': '&#x3D;',
}

/**
 * Escapes the backtick and `=` as well as the obvious four. Both matter for
 * unquoted attribute values, which some webmail sanitisers reintroduce when
 * they rewrite markup: with only the four, a value of `x onload=alert(1)`
 * lands in the document as a second attribute.
 */
export const escapeHtml = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[&<>"'`=]/g, (c) => ESCAPES[c] as string)
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  shy: '',
  zwnj: '',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  bull: '•',
  middot: '·',
  times: '×',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  deg: '°',
  sect: '§',
  para: '¶',
  dagger: '†',
  permil: '‰',
  larr: '←',
  rarr: '→',
}

export const decodeEntities = (input: string): string =>
  input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (match, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = hex ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1))
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    }
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? match
  })

export const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

/** Elements whose content is raw text: a `<` inside one of these is not a tag. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title'])

export interface TagMatch {
  /** Lowercased tag name. */
  name: string
  closing: boolean
  selfClosing: boolean
  /** Attribute source, between the tag name and the closing angle bracket. */
  attrs: string
  /** Offsets into the input, so callers can splice without re-parsing. */
  start: number
  end: number
}

const TAG_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![a-zA-Z][^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:'[^']*'|"[^"]*"|[^>'"])*?)(\/?)>/g

/** Yields every element tag in document order, skipping comments and raw text. */
export function* scanTags(html: string): Generator<TagMatch> {
  const lower = html.toLowerCase()
  TAG_RE.lastIndex = 0
  for (let match = TAG_RE.exec(html); match !== null; match = TAG_RE.exec(html)) {
    const name = match[2]
    if (name === undefined) continue
    const tagName = name.toLowerCase()
    const tag: TagMatch = {
      name: tagName,
      closing: match[1] === '/',
      selfClosing: match[4] === '/' || VOID_ELEMENTS.has(tagName),
      attrs: match[3] ?? '',
      start: match.index,
      end: match.index + match[0].length,
    }
    yield tag
    if (!tag.closing && !tag.selfClosing && RAW_TEXT.has(tagName)) {
      const close = lower.indexOf(`</${tagName}`, tag.end)
      if (close !== -1) TAG_RE.lastIndex = close
    }
  }
}

const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g

export const parseAttrs = (source: string): Map<string, string> => {
  const out = new Map<string, string>()
  ATTR_RE.lastIndex = 0
  for (let m = ATTR_RE.exec(source); m !== null; m = ATTR_RE.exec(source)) {
    const key = (m[1] as string).toLowerCase()
    if (!out.has(key)) out.set(key, m[2] ?? m[3] ?? m[4] ?? '')
  }
  return out
}

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:', 'sms:', 'cid:'])

/**
 * Whether a url is one an email client should be allowed to follow. Unsafe
 * schemes are dropped rather than escaped: an escaped `javascript:` href is
 * still a link, and clients that normalise entities before dispatching a click
 * will happily un-escape it back into an executable one.
 *
 * Control characters are stripped before the scheme test because `java\nscript:`
 * is treated as `javascript:` by more parsers than you would hope.
 */
export const isSafeUrl = (url: string): boolean => {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberate obfuscation check
  const trimmed = url.replace(/[\x00-\x20\x7f]/g, '')
  if (trimmed === '') return true
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)
  if (scheme === null) return true
  return SAFE_SCHEMES.has(`${scheme[1]!.toLowerCase()}:`)
}

/**
 * Attribute escaping for urls. Deliberately narrower than `escapeHtml`: a
 * tracking url is `?a=b&c=d`, and turning every `=` into `&#x3D;` — legal, but
 * unusual — trips naive link scanners at the receiving end, which then rewrite
 * or flag the link. Only the characters that would actually terminate the
 * attribute or start an entity are escaped.
 */
export const escapeUrlAttr = (url: string): string =>
  url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Serialises an attribute map back to source; empty values render as booleans. */
export const serializeAttrs = (attrs: Iterable<readonly [string, string]>): string => {
  const parts: string[] = []
  for (const [key, value] of attrs) parts.push(value === '' ? key : `${key}="${escapeHtml(value)}"`)
  return parts.length === 0 ? '' : ` ${parts.join(' ')}`
}
