import type { GuideMeta } from '~/content/guides/manifest.ts'
import { GUIDES, guidePath } from '~/content/site-map.ts'
import type { PageHead } from './head.ts'
import { pageHead } from './head.ts'
import type { FaqEntry, TechArticleEntry } from './schema.ts'
import {
  blogPostingSchemas,
  breadcrumbSchema,
  faqPageSchema,
  techArticleSchemas,
} from './schema.ts'

/**
 * One head for every guide.
 *
 * Twenty-six route files each hand-assembling four schema builders is
 * twenty-six chances to ship a page with the wrong canonical or a missing
 * breadcrumb, and the mistake is invisible in the browser. Each route calls
 * this with its slug instead, and gets the same six lines.
 *
 * `blogPostingSchemas` was written for exactly this and had no callers until
 * now, which is why `NoteEntry` and `GuideSection` already have the same shape.
 */

/**
 * The manifest is pure data and declares its own types, so it cannot import
 * these. Asserting assignability here — in a file where `~/seo` is legal — is
 * what keeps the two definitions from drifting: if a field is renamed on either
 * side, this file stops compiling.
 */
const _sectionsAreArticleEntries: (guide: GuideMeta) => TechArticleEntry[] = (guide) =>
  guide.sections
const _faqAreFaqEntries: (guide: GuideMeta) => FaqEntry[] = (guide) => guide.faq

const bySlug = new Map(GUIDES.map((guide) => [guide.slug, guide]))

export const guideBySlug = (slug: string): GuideMeta => {
  const guide = bySlug.get(slug)
  /**
   * Thrown at module evaluation, which means the build fails rather than the
   * page shipping. `prerender.failOnError` is on, so a route file whose slug
   * has no manifest entry stops the build with this message instead of
   * publishing a page with a canonical pointing at a URL that is not in the
   * sitemap.
   */
  if (!guide) {
    throw new Error(
      `No guide in the manifest for slug "${slug}". ` +
        'Add it to src/content/guides/manifest.ts, or delete the route file.',
    )
  }
  return guide
}

export const guideHead = (slug: string): PageHead => {
  const guide = guideBySlug(slug)
  const path = guidePath(guide.slug)

  return pageHead({
    title: guide.title,
    description: guide.description,
    path,
    image: '/og/docs.png',
    ogType: 'article',
    jsonLd: [
      breadcrumbSchema([
        { name: 'Guides', path: '/guides' },
        { name: guide.title, path },
      ]),
      ...blogPostingSchemas(
        path,
        guide.sections.map((section) => ({
          anchor: section.anchor,
          headline: section.headline,
          description: section.description,
          section: guide.category,
          datePublished: guide.published,
        })),
      ),
      ...techArticleSchemas(path, guide.sections),
      faqPageSchema(guide.faq),
    ],
  })
}
