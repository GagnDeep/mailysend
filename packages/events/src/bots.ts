import type { AudienceClass } from '@mailysend/contracts'

/**
 * Open and click classification.
 *
 * Since Apple Mail Privacy Protection shipped, a raw open rate is not a
 * measurement of anything — MPP pre-fetches every image for every message
 * whether or not the recipient looks at it, and it accounts for a large share
 * of consumer mail. Security scanners do the same to links.
 *
 * The approach here is: classify at the edge, store everything, and default the
 * charts to `human`. Nothing is discarded, because a customer investigating a
 * specific message needs to see the scanner hit too — but a headline "open
 * rate" that silently includes MPP is a number that cannot be reasoned about,
 * and this product's whole argument is about not shipping those.
 */

export interface ClassifyInput {
  userAgent?: string | null
  ip?: string | null
  /** Milliseconds between the delivery event and this hit. */
  msSinceDelivery?: number | null
  /** How many distinct links from this message were hit in the last 2 seconds. */
  recentLinkHits?: number
  method?: string
  /** Cloudflare fills these in; absent on other runtimes. */
  cfVerifiedBot?: boolean
  cfAsn?: number | null
}

const MPP_UA = /GoogleImageProxy|Apple-?Mail|iPhone Mail|MacOutlook.*Preview/i
const APPLE_PRIVATE_RELAY_UA =
  /Mozilla\/5\.0 \(Macintosh; Intel Mac OS X 10_15_7\) AppleWebKit\/605\.1\.15 \(KHTML, like Gecko\)$/

const SCANNER_UA =
  /Barracuda|Proofpoint|Mimecast|Symantec|Forcepoint|MessageLabs|TrendMicro|FireEye|Cisco|IronPort|Sophos|McAfee|Fortinet|Zscaler|urlscan|VirusTotal|SafeLinks|ATP|Defender/i

const BOT_UA =
  /bot\b|crawler|spider|slurp|curl\/|wget|python-requests|okhttp|axios|Go-http-client|Java\/|libwww|HeadlessChrome|PhantomJS|Playwright|Puppeteer|monitoring|uptime|pingdom|newrelic/i

/** Apple's Private Relay egress and iCloud infrastructure. */
const APPLE_ASNS = new Set([714, 6185, 2709])
/** Google's image proxy egress. */
const GOOGLE_ASNS = new Set([15169, 396982])

export function classifyHit(input: ClassifyInput): { class: AudienceClass; reason: string } {
  const ua = input.userAgent ?? ''

  // A HEAD request is never a person: no mail client fetches an image or
  // follows a link with HEAD.
  if (input.method && input.method.toUpperCase() === 'HEAD') {
    return { class: 'scanner', reason: 'HEAD request' }
  }

  if (SCANNER_UA.test(ua)) return { class: 'scanner', reason: 'security vendor user agent' }

  // Several distinct links from one message inside two seconds is a link
  // checker walking the message, not a reader.
  if ((input.recentLinkHits ?? 0) >= 3) {
    return { class: 'scanner', reason: 'three or more links hit within two seconds' }
  }

  if (/GoogleImageProxy/i.test(ua)) {
    // Gmail proxies and caches images. If the fetch lands within a couple of
    // seconds of delivery, it is the cache warming, not the recipient opening.
    if ((input.msSinceDelivery ?? Number.POSITIVE_INFINITY) < 2000) {
      return { class: 'proxy_prefetch', reason: 'Gmail image proxy within 2s of delivery' }
    }
    return { class: 'human', reason: 'Gmail image proxy, delayed — likely a real open' }
  }

  if (MPP_UA.test(ua) || APPLE_PRIVATE_RELAY_UA.test(ua)) {
    return { class: 'mpp', reason: 'Apple Mail Privacy Protection' }
  }
  if (input.cfAsn && APPLE_ASNS.has(input.cfAsn)) {
    return { class: 'mpp', reason: 'Apple Private Relay network' }
  }
  if (
    input.cfAsn &&
    GOOGLE_ASNS.has(input.cfAsn) &&
    (input.msSinceDelivery ?? Number.POSITIVE_INFINITY) < 2000
  ) {
    return { class: 'proxy_prefetch', reason: 'Google network within 2s of delivery' }
  }

  if (input.cfVerifiedBot) return { class: 'bot', reason: 'verified bot' }
  if (BOT_UA.test(ua)) return { class: 'bot', reason: 'automation user agent' }
  if (!ua) return { class: 'bot', reason: 'no user agent' }

  return { class: 'human', reason: 'no bot signal' }
}

/**
 * Which classes count toward the headline rates.
 *
 * `proxy_prefetch` is excluded rather than treated as an open: it says the mail
 * arrived, which we already know from the delivery event, and nothing about
 * whether anyone read it.
 */
export const COUNTS_AS_ENGAGEMENT: AudienceClass[] = ['human']

export const isHumanEngagement = (cls: AudienceClass): boolean => COUNTS_AS_ENGAGEMENT.includes(cls)

/**
 * The rate we are willing to put a number on.
 *
 * MPP opens are removed from both numerator and denominator, because we cannot
 * tell what an MPP recipient did — including them as opens inflates the rate,
 * and counting them as non-opens deflates it. Excluding them entirely and
 * labelling the result is the only honest option, and the UI says so.
 */
export const privacyAdjustedOpenRate = (counts: {
  delivered: number
  humanOpens: number
  mppOpens: number
}): { rate: number | null; excluded: number; note: string } => {
  const denominator = counts.delivered - counts.mppOpens
  if (denominator <= 0) {
    return {
      rate: null,
      excluded: counts.mppOpens,
      note: 'Every delivery in this window was to a privacy-protected mailbox, so no open rate can be computed.',
    }
  }
  return {
    rate: counts.humanOpens / denominator,
    excluded: counts.mppOpens,
    note: `${counts.mppOpens.toLocaleString()} privacy-protected opens excluded from both sides of the ratio.`,
  }
}
