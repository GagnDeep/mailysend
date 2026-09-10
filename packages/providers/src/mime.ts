import { formatAddress, signMessage } from '@mailysend/core'
import type { OutboundMessage } from './types.ts'

/**
 * RFC 5322 message construction.
 *
 * Needed because Cloudflare's `send_email` binding and raw SMTP both take a
 * complete message rather than structured fields. Written by hand rather than
 * pulled from a library because the pieces that matter here — deterministic
 * boundaries, a stamped Message-ID, correct folding of non-ASCII subjects — are
 * exactly the pieces general-purpose builders get subtly wrong, and a subtly
 * wrong header is a deliverability problem that takes weeks to notice.
 */

const CRLF = '\r\n'

/** RFC 2047 encoded-word. Required for any header value outside printable ASCII. */
const encodeHeaderValue = (value: string): string => {
  if (!/[^\x20-\x7E]/.test(value)) return value
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(value)))
  return `=?UTF-8?B?${b64}?=`
}

/**
 * Folds a long header at 76 characters. Some MTAs reject or truncate headers
 * over 998 octets outright, and a truncated DKIM-relevant header breaks the
 * signature rather than merely looking untidy.
 */
const foldHeader = (name: string, value: string): string => {
  const line = `${name}: ${value}`
  if (line.length <= 76) return line
  const out: string[] = []
  let current = `${name}:`
  for (const word of value.split(' ')) {
    if (current.length + word.length + 1 > 76) {
      out.push(current)
      current = ` ${word}`
    } else {
      current += ` ${word}`
    }
  }
  out.push(current)
  return out.join(`${CRLF} `)
}

const base64Chunked = (bytes: Uint8Array): string => {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  const b64 = btoa(bin)
  return (b64.match(/.{1,76}/g) ?? []).join(CRLF)
}

/**
 * Quoted-printable for text parts. 8-bit is widely accepted now, but not
 * universally, and QP costs nothing while removing an entire class of
 * "the accents turned into question marks" reports.
 */
const quotedPrintable = (input: string): string => {
  const bytes = new TextEncoder().encode(input)
  let out = ''
  let lineLen = 0
  const push = (s: string) => {
    if (lineLen + s.length > 75) {
      out += `=${CRLF}`
      lineLen = 0
    }
    out += s
    lineLen += s.length
  }
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!
    if (b === 13 && bytes[i + 1] === 10) {
      out += CRLF
      lineLen = 0
      i++
    } else if (b === 10) {
      out += CRLF
      lineLen = 0
    } else if (b === 61) {
      push('=3D')
    } else if (b >= 33 && b <= 126) {
      push(String.fromCharCode(b))
    } else if (
      (b === 32 || b === 9) &&
      bytes[i + 1] !== 10 &&
      bytes[i + 1] !== 13 &&
      i !== bytes.length - 1
    ) {
      push(String.fromCharCode(b))
    } else {
      push(`=${b.toString(16).toUpperCase().padStart(2, '0')}`)
    }
  }
  return out
}

/**
 * Boundaries are derived from the email id rather than randomly generated, so
 * building the same message twice produces byte-identical output. That is what
 * makes a retry after an unknown outcome comparable to the original, and what
 * makes the raw-message archive in R2 verifiable.
 */
const boundary = (emailId: string, part: string) =>
  `--=_MS_${part}_${emailId.replace(/[^A-Za-z0-9]/g, '')}`

export interface BuildOptions {
  /** Injected as List-Unsubscribe; required for bulk mail at Gmail and Yahoo. */
  unsubscribeUrl?: string
  unsubscribeMailto?: string
  date?: Date
}

export function buildMime(message: OutboundMessage, options: BuildOptions = {}): string {
  const {
    emailId,
    from,
    to,
    cc,
    replyTo,
    subject,
    html,
    text,
    headers = {},
    attachments = [],
  } = message
  const date = options.date ?? new Date()

  const lines: string[] = []
  const header = (name: string, value: string) => lines.push(foldHeader(name, value))

  header('From', formatAddress(from))
  header('To', to.map(formatAddress).join(', '))
  if (cc?.length) header('Cc', cc.map(formatAddress).join(', '))
  if (replyTo?.length) header('Reply-To', replyTo.map(formatAddress).join(', '))
  header('Subject', encodeHeaderValue(subject))
  header('Date', date.toUTCString().replace('GMT', '+0000'))

  // The id we minted, stamped into the message itself. This is what lets a DSN
  // arriving days later — through a provider we may no longer be using — be
  // matched back to the send.
  header('Message-ID', `<${emailId}@${from.domain}>`)
  header('X-MailySend-Id', emailId)
  header('MIME-Version', '1.0')

  if (options.unsubscribeUrl || options.unsubscribeMailto) {
    const parts = [
      options.unsubscribeMailto ? `<mailto:${options.unsubscribeMailto}>` : null,
      options.unsubscribeUrl ? `<${options.unsubscribeUrl}>` : null,
    ].filter(Boolean)
    header('List-Unsubscribe', parts.join(', '))
    // Without this, Gmail shows no one-click control and the header is decorative.
    if (options.unsubscribeUrl) header('List-Unsubscribe-Post', 'List-Unsubscribe=One-Click')
  }

  for (const [k, v] of Object.entries(headers)) {
    // Callers must not be able to forge routing or identity headers.
    if (
      /^(from|to|cc|bcc|subject|date|message-id|mime-version|content-type|content-transfer-encoding|dkim-signature|return-path|received)$/i.test(
        k,
      )
    ) {
      continue
    }
    header(k, encodeHeaderValue(v))
  }

  const hasAttachments = attachments.length > 0
  const inline = attachments.filter((a) => a.contentId)
  const regular = attachments.filter((a) => !a.contentId)
  const hasAlternative = Boolean(html && text)

  const altBoundary = boundary(emailId, 'alt')
  const relBoundary = boundary(emailId, 'rel')
  const mixBoundary = boundary(emailId, 'mix')

  const textPart = () =>
    [
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: quoted-printable`,
      '',
      quotedPrintable(text ?? ''),
    ].join(CRLF)

  const htmlPart = () =>
    [
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: quoted-printable`,
      '',
      quotedPrintable(html ?? ''),
    ].join(CRLF)

  const attachmentPart = (a: (typeof attachments)[number]) =>
    [
      `Content-Type: ${a.contentType}; name="${a.filename.replace(/"/g, '')}"`,
      `Content-Transfer-Encoding: base64`,
      a.contentId
        ? `Content-Disposition: inline; filename="${a.filename.replace(/"/g, '')}"`
        : `Content-Disposition: attachment; filename="${a.filename.replace(/"/g, '')}"`,
      ...(a.contentId ? [`Content-ID: <${a.contentId}>`] : []),
      '',
      base64Chunked(a.content),
    ].join(CRLF)

  /** text/plain + text/html, in that order — clients pick the last they can render. */
  const buildAlternative = (): string => {
    if (!hasAlternative) return html ? htmlPart() : textPart()
    return [
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      `--${altBoundary}`,
      textPart(),
      `--${altBoundary}`,
      htmlPart(),
      `--${altBoundary}--`,
    ].join(CRLF)
  }

  /** multipart/related wraps the body with its cid: images. */
  const buildRelated = (): string => {
    if (inline.length === 0) return buildAlternative()
    return [
      `Content-Type: multipart/related; boundary="${relBoundary}"`,
      '',
      `--${relBoundary}`,
      buildAlternative(),
      ...inline.flatMap((a) => [`--${relBoundary}`, attachmentPart(a)]),
      `--${relBoundary}--`,
    ].join(CRLF)
  }

  if (!hasAttachments) {
    return [...lines, buildAlternative(), ''].join(CRLF)
  }

  if (regular.length === 0) {
    return [...lines, buildRelated(), ''].join(CRLF)
  }

  return [
    ...lines,
    `Content-Type: multipart/mixed; boundary="${mixBoundary}"`,
    '',
    `--${mixBoundary}`,
    buildRelated(),
    ...regular.flatMap((a) => [`--${mixBoundary}`, attachmentPart(a)]),
    `--${mixBoundary}--`,
    '',
  ].join(CRLF)
}

/** Byte length of the rendered message, for the per-provider size check. */
export const mimeSize = (raw: string): number => new TextEncoder().encode(raw).byteLength

/**
 * `buildMime`, then actually signed.
 *
 * Every adapter that puts raw MIME on the wire calls this rather than
 * `buildMime` directly. Until it existed, `message.dkim` was carried the whole
 * length of the send path and read by nobody: the DNS record promised a
 * signature that never arrived, which is the one DKIM failure mode worse than
 * having no key at all.
 *
 * A signing failure is not a send failure. A message that goes out unsigned
 * lands in a spam folder; a message that does not go out at all is a bug the
 * sender did not ask for. The failure is logged and the unsigned message is
 * returned.
 */
export async function buildSignedMime(
  message: OutboundMessage,
  options: BuildOptions = {},
): Promise<string> {
  const raw = buildMime(message, options)
  if (!message.dkim?.privateKey) return raw
  try {
    return await signMessage(raw, {
      domain: message.dkim.domain,
      selector: message.dkim.selector,
      privateKey: message.dkim.privateKey,
    })
  } catch (err) {
    console.warn('[mime] DKIM signing failed; sending unsigned', err)
    return raw
  }
}
