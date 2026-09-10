/**
 * Every public page, written down once.
 *
 * This list used to exist four times — `PRERENDER_ROUTES` in vite.config.ts,
 * `ORDER` in scripts/llms-full.ts, the `SITEMAP` array on /resources, and a
 * hand-typed set of absolute URLs in public/llms.txt — and the four had already
 * drifted: only three of them knew about `/setup`. Adding a page meant editing
 * four files and noticing that you had to, which is not a thing anyone notices.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS FILE MUST STAY PURE DATA. NO IMPORTS — not even `import type`.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It is loaded by three different loaders: Vite's esbuild config bundler (for
 * vite.config.ts), `tsx` (for the post-build scripts), and the app's own
 * pipeline. Their intersection allows relative specifiers with explicit
 * extensions and nothing else. A stray `@mailysend/ui` import gets externalised
 * by the config bundler and dies at config-load time with a syntax error naming
 * a UI component, never mentioning vite.config.ts. A stray `~/seo/site.ts`
 * import is worse, because it *succeeds*: `import.meta.env` is undefined under
 * the config bundler, the optional chain saves it, and a self-hosted build then
 * quietly computes mailysend.com URLs into its own sitemap.
 *
 * `content/site-map.test.ts` asserts the absence of imports with a regex over
 * the file text, so "pure data" is enforced rather than merely requested.
 */

/** Sitemap `changefreq`, narrowed to the two values this site actually uses. */
export type ChangeFreq = 'weekly' | 'monthly'

export interface PublicPage {
  /** Absolute path, no trailing slash (except the root). Prerendered as-is. */
  path: string
  /** Card title on /resources, and the nav label where one is generated. */
  label: string
  /** One line under the card title. Sentence fragment, no full stop. */
  blurb: string
  group: 'Product' | 'Reference' | 'Account' | 'Legal'
  priority: number
  changefreq: ChangeFreq
  /**
   * Where this page appears in llms-full.txt, and the heading it gets there.
   * The heading differs from `label` on purpose: a card in a grid has the
   * surrounding page for context, a heading in a flat text file does not.
   */
  llms: { order: number; heading: string }
}

export const PUBLIC_PAGES: PublicPage[] = [
  {
    path: '/',
    label: 'Home',
    blurb: 'What it is, in three lines of code',
    group: 'Product',
    priority: 1,
    changefreq: 'weekly',
    llms: { order: 10, heading: 'Home' },
  },
  {
    path: '/docs',
    label: 'Docs',
    blurb: 'Quickstart, full API, SDKs, providers',
    group: 'Reference',
    priority: 0.9,
    changefreq: 'weekly',
    llms: { order: 20, heading: 'Docs' },
  },
  {
    path: '/guides',
    label: 'Guides',
    blurb: 'Task-shaped how-tos, with the product doing the arithmetic',
    group: 'Reference',
    priority: 0.9,
    changefreq: 'weekly',
    llms: { order: 30, heading: 'Guides index' },
  },
  {
    path: '/analytics',
    label: 'Analytics',
    blurb: 'Placement, DMARC, exports, alerts',
    group: 'Product',
    priority: 0.7,
    changefreq: 'weekly',
    llms: { order: 40, heading: 'Deliverability analytics' },
  },
  {
    path: '/dashboard-tour',
    label: 'Product tour',
    blurb: 'Six dashboard screens',
    group: 'Product',
    priority: 0.7,
    changefreq: 'weekly',
    llms: { order: 50, heading: 'Product tour' },
  },
  {
    path: '/use-cases',
    label: 'Use cases',
    blurb: 'OTPs, receipts, drips, inbound, agents',
    group: 'Product',
    priority: 0.7,
    changefreq: 'weekly',
    llms: { order: 60, heading: 'Use cases' },
  },
  {
    path: '/stack',
    label: 'Stack & cost',
    blurb: 'Eleven Cloudflare products, priced',
    group: 'Product',
    priority: 0.7,
    changefreq: 'weekly',
    llms: { order: 70, heading: 'Stack & cost' },
  },
  {
    path: '/pricing',
    label: 'What it costs',
    blurb: 'No plans — the calculator',
    group: 'Product',
    priority: 0.7,
    changefreq: 'weekly',
    llms: { order: 80, heading: 'Pricing' },
  },
  {
    path: '/compare',
    label: 'Compare & migrate',
    blurb: 'Resend, SES, SendGrid, Postmark, Mailgun',
    group: 'Product',
    priority: 0.7,
    changefreq: 'weekly',
    llms: { order: 90, heading: 'Compare & migrate' },
  },
  {
    path: '/resources',
    label: 'Resources',
    blurb: 'Deploy guide, changelog, glossary, status',
    group: 'Reference',
    priority: 0.7,
    changefreq: 'weekly',
    llms: { order: 100, heading: 'Resources' },
  },
  {
    path: '/sign-in',
    label: 'Sign in',
    blurb: 'Cloudflare Access or a one-time code',
    group: 'Account',
    priority: 0.7,
    changefreq: 'monthly',
    llms: { order: 110, heading: 'Sign in' },
  },
  {
    path: '/sign-up',
    label: 'Sign up',
    blurb: 'There is no account to create — deploy instead',
    group: 'Account',
    priority: 0.7,
    changefreq: 'monthly',
    llms: { order: 120, heading: 'Sign up' },
  },
  {
    path: '/setup',
    label: 'Setup',
    blurb: 'Claim your instance after the deploy',
    group: 'Account',
    priority: 0.7,
    changefreq: 'monthly',
    // Absent from the old `ORDER` array, which is exactly the drift this file
    // exists to end: /setup has been prerendered and unlisted since it shipped.
    llms: { order: 130, heading: 'Setup' },
  },
  {
    path: '/legal/privacy',
    label: 'Privacy',
    blurb: 'What we hold, and what we cannot see',
    group: 'Legal',
    priority: 0.7,
    changefreq: 'monthly',
    llms: { order: 140, heading: 'Privacy' },
  },
  {
    path: '/legal/terms',
    label: 'Terms',
    blurb: 'MIT, as-is, and acceptable use',
    group: 'Legal',
    priority: 0.7,
    changefreq: 'monthly',
    llms: { order: 150, heading: 'Terms' },
  },
  {
    path: '/legal/dpa',
    label: 'DPA',
    blurb: 'Roles, sub-processors, transfers',
    group: 'Legal',
    priority: 0.7,
    changefreq: 'monthly',
    llms: { order: 160, heading: 'DPA' },
  },
]
