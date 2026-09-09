import type { NormalizedEvent } from '@mailysend/contracts'

/** The bounce taxonomy, taken from the normalized event so the two cannot drift. */
type Bounce = NonNullable<NormalizedEvent['bounce_class']>

/**
 * Bounce classification.
 *
 * The distinction that actually matters is hard vs. soft, because a hard bounce
 * suppresses the address permanently and a soft one must not. Getting this
 * wrong in either direction is costly: suppressing on a full mailbox loses a
 * real subscriber forever, and *not* suppressing on an invalid address keeps
 * hammering a receiver that is already judging your reputation by exactly that
 * behaviour.
 *
 * Enhanced status codes (RFC 3463) are the reliable signal where present; the
 * text heuristics are the fallback for MTAs that do not emit them.
 */

export interface BounceInput {
  smtpCode?: string | null
  /** The full diagnostic text, e.g. `550 5.1.1 <a@b.com>: user unknown`. */
  diagnostic?: string | null
  /** Some providers pre-classify. Trusted when present, verified against the text. */
  providerType?: string | null
  providerSubType?: string | null
}

const ENHANCED = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/

export function classifyBounce(input: BounceInput): { class: Bounce; permanent: boolean } {
  const text =
    `${input.diagnostic ?? ''} ${input.providerType ?? ''} ${input.providerSubType ?? ''}`.toLowerCase()
  const code = String(input.smtpCode ?? '')

  // Providers that classify for us are usually right, and they see things we
  // cannot (their own suppression list, feedback loops).
  if (input.providerType) {
    const t = input.providerType.toLowerCase()
    if (t === 'permanent' || t === 'hardbounce' || t === 'hard_bounce') {
      const sub = (input.providerSubType ?? '').toLowerCase()
      if (sub.includes('suppress')) return { class: 'hard_blocked', permanent: true }
      if (sub.includes('nodomain') || sub.includes('domain'))
        return { class: 'hard_domain', permanent: true }
      return { class: 'hard_invalid', permanent: true }
    }
    if (t === 'transient' || t === 'softbounce' || t === 'soft_bounce') {
      if ((input.providerSubType ?? '').toLowerCase().includes('full')) {
        return { class: 'soft_mailbox_full', permanent: false }
      }
      return { class: 'soft_temporary', permanent: false }
    }
  }

  const enhanced = (input.diagnostic ?? '').match(ENHANCED)
  if (enhanced) {
    const [, cls, subject, detail] = enhanced
    const permanent = cls === '5'
    const key = `${subject}.${detail}`
    if (key === '1.1' || key === '1.3' || key === '1.6') {
      return { class: permanent ? 'hard_invalid' : 'soft_temporary', permanent }
    }
    if (key === '1.2') return { class: 'hard_domain', permanent: true }
    if (key === '2.2') return { class: 'soft_mailbox_full', permanent: false }
    if (key === '7.1' || subject === '7') {
      // 5.7.x is policy: blocked, not invalid. The address may be perfectly
      // real, so it suppresses but is worth surfacing differently in the UI.
      return { class: permanent ? 'hard_blocked' : 'soft_throttled', permanent }
    }
    if (key === '3.4' || key === '2.3') return { class: 'soft_content', permanent: false }
    if (subject === '4') return { class: 'soft_temporary', permanent: false }
    return { class: permanent ? 'hard_invalid' : 'soft_temporary', permanent }
  }

  if (/mailbox (is )?full|over quota|quota exceeded|insufficient storage/.test(text)) {
    return { class: 'soft_mailbox_full', permanent: false }
  }
  if (/rate limit|too many|throttl|try again later|deferred|greylist/.test(text)) {
    return { class: 'soft_throttled', permanent: false }
  }
  if (/spam|content rejected|message rejected for policy|dmarc|spf|dkim/.test(text)) {
    return { class: 'soft_content', permanent: false }
  }
  if (
    /no such (user|mailbox)|user unknown|recipient (address )?rejected|does not exist|invalid recipient|unknown user/.test(
      text,
    )
  ) {
    return { class: 'hard_invalid', permanent: true }
  }
  if (/domain not found|no mx|host unknown|nxdomain|unrouteable/.test(text)) {
    return { class: 'hard_domain', permanent: true }
  }
  if (/blocked|blacklist|blocklist|denied|reputation|spamhaus/.test(text)) {
    return { class: 'hard_blocked', permanent: true }
  }

  if (code.startsWith('5')) return { class: 'hard_invalid', permanent: true }
  if (code.startsWith('4')) return { class: 'soft_temporary', permanent: false }

  // Unknown deliberately does NOT suppress. An unrecognised diagnostic is a gap
  // in this function, and the cost of guessing wrong is a lost subscriber.
  return { class: 'unknown', permanent: false }
}

/** How long a soft-bounce suppression should hold before the address is retried. */
export const softSuppressionDays = (bounceClass: Bounce): number | null => {
  switch (bounceClass) {
    case 'soft_mailbox_full':
      return 7
    case 'soft_throttled':
      return 1
    case 'soft_content':
      return 3
    case 'soft_temporary':
      return 2
    default:
      return null
  }
}
