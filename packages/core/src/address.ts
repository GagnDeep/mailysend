/**
 * Address parsing and header construction.
 *
 * Every provider takes a different shape (`send_email` wants raw MIME, SES
 * wants structured JSON, Resend wants its own JSON), so addresses are parsed
 * once here into a neutral form and each adapter formats from that.
 */

export interface ParsedAddress {
  address: string
  name?: string
  domain: string
}

const ADDR_WITH_NAME = /^\s*(?:"([^"]*)"|([^<]*?))\s*<([^>]+)>\s*$/

export const parseAddress = (input: string): ParsedAddress | null => {
  const m = input.match(ADDR_WITH_NAME)
  const address = (m ? m[3]! : input).trim().toLowerCase()
  const at = address.lastIndexOf('@')
  if (at < 1 || at === address.length - 1) return null
  const name = m ? (m[1] ?? m[2] ?? '').trim() : ''
  return { address, domain: address.slice(at + 1), ...(name ? { name } : {}) }
}

export const parseAddresses = (input: string[] | string): ParsedAddress[] =>
  (Array.isArray(input) ? input : [input])
    .map(parseAddress)
    .filter((a): a is ParsedAddress => a !== null)

/**
 * RFC 5322 display names need quoting when they contain specials, and encoding
 * when they are not ASCII. Getting this wrong is how "José" becomes a broken
 * header that some MTAs reject outright.
 */
export const formatAddress = (a: ParsedAddress): string => {
  if (!a.name) return a.address
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7E]/.test(a.name)) {
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(a.name)))
    return `=?UTF-8?B?${b64}?= <${a.address}>`
  }
  return /[",;:<>@[\]\\]/.test(a.name)
    ? `"${a.name.replace(/(["\\])/g, '\\$1')}" <${a.address}>`
    : `${a.name} <${a.address}>`
}

/** The registrable domain, so `mail.shop.example.co.uk` matches a `example.co.uk` sending identity. */
export const rootDomain = (domain: string): string => {
  const parts = domain.toLowerCase().split('.')
  if (parts.length <= 2) return parts.join('.')
  // A short list beats a full public-suffix table in a Worker bundle; the cost
  // of being wrong is only that a subdomain send needs its own identity row.
  const twoLevel = [
    'co.uk',
    'com.au',
    'co.jp',
    'co.nz',
    'com.br',
    'co.in',
    'com.mx',
    'co.za',
    'com.sg',
  ]
  const last2 = parts.slice(-2).join('.')
  return twoLevel.includes(last2) ? parts.slice(-3).join('.') : last2
}

/**
 * Gmail treats `a.b+tag@gmail.com` and `ab@gmail.com` as the same mailbox.
 * Suppression must follow that, or an unsubscribe is trivially circumvented by
 * a plus tag — and worse, a complaint from one alias keeps mail flowing to the
 * other, which is exactly the pattern that gets a domain blocked.
 */
export const normalizeForSuppression = (address: string): string => {
  const [local, domain] = address.toLowerCase().split('@')
  if (!local || !domain) return address.toLowerCase()
  const gmailLike = domain === 'gmail.com' || domain === 'googlemail.com'
  let normalized = local.split('+')[0]!
  if (gmailLike) normalized = normalized.replace(/\./g, '')
  return `${normalized}@${gmailLike ? 'gmail.com' : domain}`
}

/** Recipient-provider bucket for placement analytics and per-provider throttling. */
export const recipientProvider = (domain: string): string => {
  const d = domain.toLowerCase()
  if (/^(gmail|googlemail)\.com$/.test(d)) return 'gmail'
  if (/^(outlook|hotmail|live|msn)\./.test(d) || d === 'outlook.com') return 'microsoft'
  if (/^(yahoo|ymail|rocketmail)\./.test(d) || d.startsWith('yahoo.')) return 'yahoo'
  if (d.endsWith('icloud.com') || d.endsWith('me.com') || d.endsWith('mac.com')) return 'apple'
  if (d.endsWith('protonmail.com') || d.endsWith('proton.me')) return 'proton'
  if (d.endsWith('aol.com')) return 'aol'
  if (d.endsWith('zoho.com')) return 'zoho'
  return 'other'
}
