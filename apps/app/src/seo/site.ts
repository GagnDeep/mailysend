/**
 * Facts about the site that both the metadata and the structured data need to
 * agree on. A canonical URL that disagrees with the one inside the JSON-LD is
 * the single most common way a page ends up de-duplicated against itself, so
 * every absolute URL on the site is built from `SITE_URL` and nothing else.
 */
declare const __MS_SITE_URL__: string | undefined

/**
 * The canonical origin, or the empty string when this build has none.
 *
 * Compiled in by `vite.config.ts` from the same value that decides the sitemap
 * host, so a page's canonical, `sitemap.xml` and `robots.txt` cannot name three
 * different sites. This used to read `import.meta.env.VITE_PUBLIC_URL` — a
 * variable set nowhere in this repository — and so always resolved to a
 * hardcoded `https://mailysend.com`, which is correct for exactly one
 * deployment and wrong for every fork of it.
 *
 * Empty is deliberate rather than a fallback. A deployment that has not been
 * told its own address should not claim somebody else's: see `absoluteUrl`.
 */
export const SITE_URL = (typeof __MS_SITE_URL__ === 'string' ? __MS_SITE_URL__ : '').replace(
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

/**
 * The real one-click target. Every "Deploy to Cloudflare" affordance points
 * here, so the button in the product and the button in the README are the same
 * button — Cloudflare forks the repo, reads `apps/app/wrangler.jsonc` for the
 * bindings and the root `.env.example` for the (entirely optional) variables
 * form, then builds and deploys.
 */
export const DEPLOY_URL = `https://deploy.workers.cloudflare.com/?url=${REPO_URL}`

/**
 * Absolute URL for a site-relative path. Idempotent for absolute input.
 *
 * With no configured host this returns the path unchanged, which is a
 * site-relative URL — resolved by the browser, by a crawler and by a JSON-LD
 * processor against the document that carries it, and therefore always naming
 * the deployment actually serving the page. The alternative is a build-time
 * guess, and a wrong guess does real damage: a canonical pointing at another
 * origin asks every search engine to drop this page in favour of that one.
 */
export const absoluteUrl = (path: string): string => {
  if (/^https?:\/\//.test(path)) return path
  const rooted = path.startsWith('/') ? path : `/${path}`
  return SITE_URL ? `${SITE_URL}${rooted}` : rooted
}
