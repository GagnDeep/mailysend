/**
 * Facts about the site that both the metadata and the structured data need to
 * agree on. A canonical URL that disagrees with the one inside the JSON-LD is
 * the single most common way a page ends up de-duplicated against itself, so
 * every absolute URL on the site is built from `SITE_URL` and nothing else.
 */
export const SITE_URL = (import.meta.env?.VITE_PUBLIC_URL ?? 'https://mailysend.com').replace(
  /\/$/,
  '',
)

export const SITE_NAME = 'MailySend'

export const SITE_TAGLINE = 'Resend, on your Cloudflare.'

export const SITE_DESCRIPTION =
  'MailySend is a Resend-compatible email platform — sending, receiving, broadcasts and ' +
  'analytics — that deploys into your own Cloudflare account. MIT licensed, no vendor bill.'

/** The @handle used for `twitter:site`. */
export const SITE_TWITTER = '@mailysend'

export const REPO_URL = 'https://github.com/GagnDeep/mailysend'

/** Absolute URL for a site-relative path. Idempotent for absolute input. */
export const absoluteUrl = (path: string): string => {
  if (/^https?:\/\//.test(path)) return path
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}
