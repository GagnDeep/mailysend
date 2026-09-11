/**
 * One statement per transport, so two screens cannot disagree about it.
 *
 * Settings → Transports renders the catalog the server sends, which is the
 * authority on labels and caveats. The domain page has no catalog — it has a
 * `provider` string on a row — and used to spell the same four transports out
 * by hand in a `<Select>`, where "Cloudflare Email Service" had drifted into
 * other wordings. These are the labels, the prerequisite a reader needs
 * *before* they bind, and where the long version lives.
 */

export type TransportName = 'cloudflare' | 'ses' | 'resend' | 'smtp'

export const TRANSPORT_LABEL: Record<TransportName, string> = {
  cloudflare: 'Cloudflare Email Service',
  ses: 'Amazon SES',
  resend: 'Resend',
  smtp: 'SMTP relay',
}

/** The docs section that explains the whole setup, not a marketing page. */
export const TRANSPORT_GUIDE: Record<TransportName, string> = {
  cloudflare: '/docs#providers',
  ses: '/docs#providers',
  resend: '/docs#providers',
  smtp: '/docs#providers',
}

/**
 * The thing that has to be true before this transport can carry mail at all.
 *
 * Both of the first two are commonly discovered *after* a domain is verified
 * and the first real send fails: the `send_email` binding is a Workers Paid
 * feature, and a new SES account is in the sandbox and will only deliver to
 * addresses that have been verified individually. Saying it on the domain page
 * costs one sentence and saves that discovery.
 */
export const TRANSPORT_PREREQ: Record<TransportName, string> = {
  cloudflare:
    'Needs a Workers Paid plan — the send_email binding does not exist on the free plan — and the domain must already be on the same Cloudflare account. Cloudflare publishes the DNS records itself; there is nothing here to copy.',
  ses: 'A new SES account is in the sandbox: it delivers only to addresses you have verified, at 200 messages a day. Request production access before you rely on it, and remember SES identities are per-region.',
  resend:
    'Resend mints its own DKIM key under its own selector, so the records for a Resend domain are fetched from Resend rather than computed here.',
  smtp: 'Whatever the relay accepts. SMTP reports no delivery events, so bounces and complaints only reach this product if the relay is configured to forward them.',
}

export const transportLabel = (provider: string | null | undefined): string =>
  provider ? (TRANSPORT_LABEL[provider as TransportName] ?? provider) : 'the workspace default'
