import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GUIDES } from '~/content/guides/manifest.ts'
import { PUBLIC_PAGES } from '~/content/site-map.ts'

/**
 * The manifest and the route files must be the same set.
 *
 * Without this the failure arrives late and expensively. A slug in the manifest
 * with no route file is a path in `pages`, and `prerender.failOnError` turns
 * that into a 404 that kills the build for all forty-two pages. A route file
 * with no manifest entry throws from `guideBySlug` at module evaluation, which
 * is at least loud, but also only during a build. Both become a failing unit
 * test that runs in milliseconds instead.
 */
const ROUTES = fileURLToPath(new URL('../src/routes/guides', import.meta.url))

const routeSlugs = readdirSync(ROUTES)
  .filter((name) => name.endsWith('.tsx') && name !== 'index.tsx')
  .map((name) => name.replace(/\.tsx$/, ''))

describe('guide routes', () => {
  it('has exactly one route file per manifest entry', () => {
    expect([...routeSlugs].sort()).toEqual([...GUIDES.map((guide) => guide.slug)].sort())
  })

  /**
   * `createFileRoute` takes the path as a string literal, so a copy-pasted
   * route file can carry the previous guide's id and typecheck perfectly — the
   * id is a valid one, just for a different page. That ships two files claiming
   * one URL and a guide that is unreachable.
   */
  it('declares the route id that matches its filename', () => {
    for (const slug of routeSlugs) {
      const source = readFileSync(join(ROUTES, `${slug}.tsx`), 'utf8')
      expect(source).toContain(`createFileRoute('/guides/${slug}')`)
      expect(source).toContain(`const SLUG = '${slug}'`)
    }
  })

  /**
   * Flat files rather than `/guides/$slug`, and this is the property that buys.
   * A dynamic route's `head({ params })` runs for any slug, so `/guides/asdf`
   * would emit a 200 with a self-referential canonical. A filename cannot
   * produce a URL that does not exist.
   */
  it('cannot mint a URL with no page behind it', () => {
    for (const slug of routeSlugs) {
      expect(
        GUIDES.some((guide) => guide.slug === slug),
        slug,
      ).toBe(true)
    }
  })

  it('gives the guides index its own public page', () => {
    expect(readdirSync(ROUTES)).toContain('index.tsx')
    expect(PUBLIC_PAGES.map((page) => page.path)).toContain('/guides')
  })
})
