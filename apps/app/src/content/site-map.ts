/**
 * Every public URL, derived once.
 *
 * `public-pages.ts` holds the hand-written pages and `guides/manifest.ts` holds
 * the guides; this file is the only place the two are joined, and it is what
 * vite.config.ts, the post-build script and /resources all read. Adding a guide
 * is now one entry in one array, and it appears in the prerender list, the
 * sitemap, llms.txt, llms-full.txt and the site map page without anyone having
 * to remember that those five things exist.
 *
 * Relative specifiers carry an explicit `.ts` extension throughout. Vite 8
 * loads this config through esbuild today, but ships a compat warning that
 * extensionless and directory-index imports stop resolving under the `native`
 * config loader that is planned to become the default — and a config that
 * fails to load is a build that fails before it prints anything useful.
 */
import { GUIDE_BASE, GUIDES } from './guides/manifest.ts'
import type { ChangeFreq, PublicPage } from './public-pages.ts'
import { PUBLIC_PAGES } from './public-pages.ts'

export type { ChangeFreq, PublicPage }
export { GUIDES, PUBLIC_PAGES }

/** `/guides/<slug>` — the one place this path is constructed. */
export const guidePath = (slug: string): string => `${GUIDE_BASE}/${slug}`

/**
 * A guide’s own page.
 *
 * Priority sits at 0.8: below /docs and the guides index, above the marketing
 * pages, because a guide is the page a search actually wants to land on.
 * `changefreq` is monthly rather than weekly, honestly — an evergreen how-to
 * that claimed weekly change would be asking crawlers to waste requests.
 */
const guidePages: PublicPage[] = GUIDES.map((guide, index) => ({
  path: guidePath(guide.slug),
  label: guide.title,
  blurb: guide.description,
  group: 'Reference',
  priority: 0.8,
  changefreq: 'monthly',
  llms: { order: 1000 + index, heading: guide.title },
}))

/** Every public URL, in reading order. */
export const ALL_PUBLIC_PAGES: PublicPage[] = [...PUBLIC_PAGES, ...guidePages].sort(
  (a, b) => a.llms.order - b.llms.order,
)

/**
 * The `pages` array for the TanStack Start plugin.
 *
 * This drives prerendering *and* sitemap.xml — they are generated from the same
 * list on purpose, so a page cannot be static without being discoverable, or
 * discoverable without being static.
 */
export const PRERENDER_PAGES = ALL_PUBLIC_PAGES.map((page) => ({
  path: page.path,
  prerender: { enabled: true },
  sitemap: { priority: page.priority, changefreq: page.changefreq },
}))

/** Route → heading, for the llms-full.txt extraction pass. */
export const LLMS_ORDER: Array<{ path: string; heading: string }> = ALL_PUBLIC_PAGES.map(
  (page) => ({ path: page.path, heading: page.llms.heading }),
)
