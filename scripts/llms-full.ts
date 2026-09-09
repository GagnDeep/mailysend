/**
 * Renders the prerendered marketing HTML into one plain-text file.
 *
 * `llms.txt` is a hand-written map; `llms-full.txt` is the whole site as text,
 * and the only version of it worth shipping is one extracted from the exact
 * HTML that deployed. Writing it by hand — or generating it once and committing
 * it — guarantees it describes a site that no longer exists, which is worse for
 * a retrieval surface than not publishing one at all.
 *
 * Runs after `vite build`, over the build output, and writes back into it.
 *
 *   tsx scripts/llms-full.ts apps/app/.output/client
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'apps/app/.output/client')
const out = join(root, 'llms-full.txt')
const site = process.env.MS_PUBLIC_URL?.replace(/\/$/, '') ?? 'https://mailysend.com'

/** Route → heading, in reading order rather than alphabetically. */
const ORDER: Array<[string, string]> = [
  ['/', 'Home'],
  ['/docs', 'Docs'],
  ['/analytics', 'Deliverability analytics'],
  ['/dashboard-tour', 'Product tour'],
  ['/use-cases', 'Use cases'],
  ['/stack', 'Stack & cost'],
  ['/pricing', 'Pricing'],
  ['/compare', 'Compare & migrate'],
  ['/resources', 'Resources'],
  ['/sign-in', 'Sign in'],
  ['/sign-up', 'Sign up'],
  ['/legal/privacy', 'Privacy'],
  ['/legal/terms', 'Terms'],
  ['/legal/dpa', 'DPA'],
]

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
  // Only `<main>`: nav and footer repeat on all fourteen pages, and fourteen
  // copies of the same link list is noise in a retrieval corpus.
  const body = /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(s)
  if (body) s = body[1]
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
  s = s.replace(/[ \t ]+/g, ' ')
  s = s.replace(/ *\n */g, '\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

const parts = [
  '# MailySend — full site text',
  '',
  'Extracted from the prerendered HTML at build time. Canonical source:',
  `${site} — map at ${site}/llms.txt`,
  '',
]

let missing = 0
for (const [route, name] of ORDER) {
  const slug = route.replace(/^\/|\/$/g, '')
  const candidates =
    route === '/'
      ? [join(root, 'index.html')]
      : [join(root, `${slug}.html`), join(root, slug, 'index.html')]
  const hit = candidates.find((c) => existsSync(c))
  if (!hit) {
    console.error(`llms-full: MISSING ${route}`)
    missing++
    continue
  }
  parts.push(`\n\n---\n\n## ${name} — ${site}${route}\n`, textOf(hit))
}

writeFileSync(out, `${parts.join('\n')}\n`, 'utf8')
console.log(`llms-full: wrote ${out} (${statSync(out).size} bytes)`)
// A page that vanished from the build is a routing regression, not a warning.
if (missing > 0) process.exit(1)
