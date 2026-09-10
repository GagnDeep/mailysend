import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GUIDES } from '~/content/guides/manifest.ts'
import { ALL_PUBLIC_PAGES, guidePath, PUBLIC_PAGES } from '~/content/site-map.ts'

/**
 * The guides manifest is data that three different loaders read, and one of its
 * constraints cannot be expressed in the type system at all.
 */

const PURE_DATA_FILES = [
  '../src/content/guides/manifest.ts',
  '../src/content/public-pages.ts',
  '../src/content/doc-sections.ts',
  '../src/content/llms-preamble.ts',
]

describe('the pure-data content modules', () => {
  /**
   * The constraint that needs a regex rather than a type.
   *
   * These files are loaded by Vite's esbuild config bundler (for
   * vite.config.ts), by `tsx` (for scripts/llms.ts), and by the app pipeline.
   * Only relative specifiers with explicit extensions survive all three.
   *
   * A stray `@mailysend/ui` import gets externalised by the config bundler,
   * Node then tries to parse a `.tsx` file, and the build dies at config-load
   * time with a syntax error naming a UI component and never mentioning
   * vite.config.ts. A stray `~/seo/site.ts` import is worse, because it
   * *succeeds*: `import.meta.env` is undefined under the config bundler, the
   * optional chain swallows it, and a self-hosted build then computes
   * mailysend.com URLs into its own sitemap. Neither failure is a type error,
   * so this is the only place the rule can be enforced.
   */
  it.each(PURE_DATA_FILES)('%s contains no import statements', (relative) => {
    const source = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    expect(source).not.toMatch(/^\s*import\b/m)
    expect(source).not.toMatch(/\brequire\(/)
  })
})

describe('the guides manifest', () => {
  it('has unique, URL-safe slugs', () => {
    const slugs = GUIDES.map((guide) => guide.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('links only to guides that exist', () => {
    const slugs = new Set(GUIDES.map((guide) => guide.slug))
    for (const guide of GUIDES) {
      for (const related of guide.related) {
        expect(slugs, `${guide.slug} → ${related}`).toContain(related)
        // A guide recommending itself is a loop, not a next step.
        expect(related).not.toBe(guide.slug)
      }
    }
  })

  it('has prerequisites that point at real pages', () => {
    const paths = new Set(ALL_PUBLIC_PAGES.map((page) => page.path))
    for (const guide of GUIDES) {
      for (const prerequisite of guide.prerequisites) {
        const [path] = prerequisite.href.split('#')
        expect(paths, `${guide.slug} → ${prerequisite.href}`).toContain(path)
      }
    }
  })

  it('has unique section anchors within each guide', () => {
    for (const guide of GUIDES) {
      const anchors = guide.sections.map((section) => section.anchor)
      expect(new Set(anchors).size, guide.slug).toBe(anchors.length)
      // `faq` and `recap` are rendered by GuideLayout itself.
      expect(anchors).not.toContain('faq')
      expect(anchors).not.toContain('recap')
    }
  })

  it('carries the metadata a reader needs before committing', () => {
    for (const guide of GUIDES) {
      expect(guide.sections.length, guide.slug).toBeGreaterThanOrEqual(4)
      expect(guide.faq.length, guide.slug).toBeGreaterThanOrEqual(3)
      expect(guide.minutes, guide.slug).toBeGreaterThan(0)
      // Literal dates, so prerendered JSON-LD is byte-stable across builds.
      expect(guide.published, guide.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(guide.updated, guide.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})

describe('the derived site map', () => {
  it('gives every guide a page', () => {
    const paths = new Set(ALL_PUBLIC_PAGES.map((page) => page.path))
    for (const guide of GUIDES) expect(paths).toContain(guidePath(guide.slug))
  })

  it('has no duplicate paths', () => {
    const paths = ALL_PUBLIC_PAGES.map((page) => page.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  /**
   * The prerenderer strips the query and the fragment before deciding the
   * output filename, so two entries differing only after a `?` or a `#` would
   * silently collide on one file — and the second would win, quietly.
   */
  it('has no path carrying a query or a fragment', () => {
    for (const page of ALL_PUBLIC_PAGES) {
      expect(page.path, page.path).not.toMatch(/[?#]/)
      expect(page.path, page.path).toMatch(/^\/($|[a-z0-9/-]+$)/)
    }
  })

  it('keeps the dashboard out of the public list', () => {
    for (const page of ALL_PUBLIC_PAGES) {
      expect(page.path.startsWith('/app')).toBe(false)
      expect(page.path.startsWith('/v1')).toBe(false)
    }
  })

  it('gives llms.txt a total order', () => {
    const orders = ALL_PUBLIC_PAGES.map((page) => page.llms.order)
    expect(new Set(orders).size).toBe(orders.length)
    expect([...orders]).toEqual([...orders].sort((a, b) => a - b))
  })

  it('still contains /setup, which the old hand-written list forgot', () => {
    expect(PUBLIC_PAGES.map((page) => page.path)).toContain('/setup')
  })
})
