/**
 * Writes llms.txt, llms-full.txt and robots.txt into the build output.
 *
 * `llms.txt` is the map, `llms-full.txt` is the whole site as text, and
 * `robots.txt` points a crawler at the sitemap. All three used to be a mix of
 * hand-written files in `public/` and a script with its own hardcoded route
 * list — four copies of "what pages exist" that had already drifted apart, and
 * three copies of `https://mailysend.com` that a self-hosted deployment shipped
 * verbatim. They are generated here from `content/site-map.ts`, which is the
 * same list that drives prerendering and sitemap.xml.
 *
 * The full text is extracted from the exact HTML that deployed, because the
 * only version of that file worth shipping is one that describes the site as it
 * is. Generating it once and committing it guarantees it describes a site that
 * no longer exists, which is worse for a retrieval surface than not publishing.
 *
 * Runs after `vite build`, over the build output, and writes back into it.
 *
 *   tsx scripts/llms.ts apps/app/.output/client
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DOC_SECTIONS } from '../apps/app/src/content/doc-sections.ts'
import { llmsPreamble, robotsTxt } from '../apps/app/src/content/llms-preamble.ts'
import { GUIDES, guidePath, LLMS_ORDER, PUBLIC_PAGES } from '../apps/app/src/content/site-map.ts'
import { loadDotEnv } from './load-dotenv.ts'

// The same file vite.config.ts read, so the host in robots.txt cannot differ
// from the host the sitemap was generated with.
loadDotEnv()

const root = resolve(process.argv[2] ?? 'apps/app/.output/client')

/**
 * The canonical host, or none.
 *
 * `MS_LANDING=marketing` identifies the one deployment allowed to claim
 * mailysend.com without being told to — every other build uses its own
 * configured URL, and a build with neither publishes no sitemap rather than a
 * wrong one. A sitemap naming somebody else's host is worse than no sitemap:
 * it points every crawler that reads it at a site the operator does not own.
 */
const site = (
  process.env.MS_PUBLIC_URL ??
  (process.env.MS_LANDING === 'marketing' ? 'https://mailysend.com' : '')
).replace(/\/$/, '')

/** Falls back only for the in-document prose, never for the Sitemap: line. */
const displaySite = site || 'https://mailysend.com'

const BLOCK =
  '(?:p|div|section|article|header|footer|li|tr|h[1-6]|br|pre|table|ul|ol|dl|dt|dd|figure|blockquote|nav|main|hr)'

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

const decodeEntities = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, body: string) => {
    if (body[0] === '#')
      return String.fromCodePoint(
        Number.parseInt(
          body.slice(body[1] === 'x' || body[1] === 'X' ? 2 : 1),
          body[1] === 'x' || body[1] === 'X' ? 16 : 10,
        ),
      )
    return ENTITIES[body.toLowerCase()] ?? whole
  })

function textOf(path: string): string {
  let s = readFileSync(path, 'utf8')
  // Only `<main>`: nav and footer repeat on every page, and forty-two copies of
  // the same link list is noise in a retrieval corpus.
  const body = /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(s)
  if (body) s = body[1] ?? s
  s = s.replace(/<(script|style|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
  s = s.replace(new RegExp(`</${BLOCK}\\s*>`, 'gi'), '\n')
  s = s.replace(new RegExp(`<${BLOCK}\\b[^>]*>`, 'gi'), '\n')
  // Two passes, because the right separator differs. A tag wrapping part of a
  // word or a syntax-highlight token must vanish outright, or every code sample
  // gains stray spaces (`'mailysend' ;`). What is left — links, buttons — sits
  // beside a sibling and needs one, or the text runs together
  // ("Deploy in one click→Swap Resend in one line").
  s = s.replace(/<\/?(?:span|em|strong|b|i|code|abbr|sup|sub|time|mark)\b[^>]*>/gi, '')
  s = s.replace(/<[^>]+>/g, ' ')
  s = decodeEntities(s)
  s = s.replace(/[ \t ]+/g, ' ')
  s = s.replace(/ *\n */g, '\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

/** Where a prerendered route landed on disk. */
const htmlFor = (route: string): string | undefined => {
  const slug = route.replace(/^\/|\/$/g, '')
  const candidates =
    route === '/'
      ? [join(root, 'index.html')]
      : [join(root, `${slug}.html`), join(root, slug, 'index.html')]
  return candidates.find((c) => existsSync(c))
}

// ---------------------------------------------------------------------------
// llms-full.txt — every page, as text
// ---------------------------------------------------------------------------

const fullParts = [
  '# MailySend — full site text',
  '',
  'Extracted from the prerendered HTML at build time. Canonical source:',
  `${displaySite} — map at ${displaySite}/llms.txt`,
  '',
]

let missing = 0
for (const { path, heading } of LLMS_ORDER) {
  const hit = htmlFor(path)
  if (!hit) {
    console.error(`llms: MISSING ${path}`)
    missing++
    continue
  }
  fullParts.push(`\n\n---\n\n## ${heading} — ${displaySite}${path}\n`, textOf(hit))
}

const fullOut = join(root, 'llms-full.txt')
writeFileSync(fullOut, `${fullParts.join('\n')}\n`, 'utf8')
console.log(`llms: wrote ${fullOut} (${statSync(fullOut).size} bytes)`)

// ---------------------------------------------------------------------------
// llms.txt — the map
// ---------------------------------------------------------------------------

const link = (path: string, label: string, blurb: string) =>
  `- [${label}](${displaySite}${path}): ${blurb}`

const groups: Array<[string, string[]]> = [
  [
    'Docs',
    [
      `- [Docs index](${displaySite}/docs): the full API and platform reference.`,
      ...DOC_SECTIONS.filter((section) => section.anchor !== 'intro').map(
        (section) =>
          `- [${section.navLabel}](${displaySite}/docs#${section.anchor}): ${section.description}`,
      ),
    ],
  ],
  [
    'Guides',
    [
      `- [Guides index](${displaySite}/guides): every guide, grouped by track.`,
      ...GUIDES.map((guide) => link(guidePath(guide.slug), guide.title, guide.description)),
    ],
  ],
  [
    'Product',
    PUBLIC_PAGES.filter((page) => page.group === 'Product').map((page) =>
      link(page.path, page.label, page.blurb),
    ),
  ],
  [
    'Optional',
    PUBLIC_PAGES.filter((page) => page.group === 'Account' || page.group === 'Legal').map((page) =>
      link(page.path, page.label, page.blurb),
    ),
  ],
]

const mapOut = join(root, 'llms.txt')
writeFileSync(
  mapOut,
  `${llmsPreamble(displaySite)}\n${groups
    .map(([title, lines]) => `## ${title}\n\n${lines.join('\n')}`)
    .join('\n\n')}\n`,
  'utf8',
)
console.log(`llms: wrote ${mapOut} (${statSync(mapOut).size} bytes)`)

// ---------------------------------------------------------------------------
// robots.txt — the same host the sitemap was generated with
// ---------------------------------------------------------------------------

/**
 * `robots.txt` only advertises a sitemap this build actually produced.
 *
 * The two decisions are made from the same `site` value, in the same process,
 * so they cannot disagree — which is the whole failure this replaces. A build
 * with no configured host writes a robots.txt with no `Sitemap:` line, rather
 * than pointing crawlers at a 404 the way the committed static file did.
 */
const sitemapPath = join(root, 'sitemap.xml')
const hasSitemap = existsSync(sitemapPath)

/**
 * Correct the sitemap's XML namespace.
 *
 * `@tanstack/start-plugin-core` writes `xmlns="https://www.sitemaps.org/..."`.
 * The sitemap protocol's namespace is the `http://` form, and an XML namespace
 * is an opaque identifier compared as an exact string — the `https://` spelling
 * is not a variant of it, it is a different namespace, so a strict parser sees
 * `<urlset>` in an unknown vocabulary rather than a sitemap. Nothing else in the
 * file is wrong, which is what makes this worth fixing here rather than
 * patching a dependency: it is one string, and the check is idempotent, so it
 * becomes a no-op the day upstream fixes it.
 */
if (hasSitemap) {
  const xml = readFileSync(sitemapPath, 'utf8')
  const corrected = xml.replace(
    /xmlns="https:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/,
    'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
  )
  if (corrected !== xml) {
    writeFileSync(sitemapPath, corrected, 'utf8')
    console.log(`llms: corrected the sitemap namespace in ${sitemapPath}`)
  }
}

const robotsOut = join(root, 'robots.txt')
writeFileSync(robotsOut, robotsTxt(displaySite, hasSitemap ? site : null), 'utf8')
console.log(`llms: wrote ${robotsOut}${hasSitemap ? ' (with sitemap)' : ' (no sitemap generated)'}`)

// A configured host that produced no sitemap is a real regression: it means the
// vite plugin's sitemap was disabled, which is exactly the silent failure this
// whole change exists to end.
if (site && !hasSitemap) {
  console.error(
    `llms: MS_PUBLIC_URL is set to ${site} but no sitemap.xml was generated.\n` +
      '      vite.config.ts disables the sitemap when it cannot resolve a host —\n' +
      '      check that the build process can read the same value.',
  )
  missing++
}

// A page that vanished from the build is a routing regression, not a warning.
if (missing > 0) process.exit(1)
