/**
 * JSON-LD builders.
 *
 * Deliberately short list. Google renders a rich result for only a handful of
 * types now, and emitting the rest is markup nobody reads: `HowTo` was retired,
 * `Course` and `ClaimReview` do not apply to us, and `AggregateRating` without
 * real ratings behind it is a fabrication that earns a manual action.
 *
 * `FAQPage` is the one exception to "only what renders". Google dropped its FAQ
 * rich result on 2026-05-07, so these never produce stars or accordions in the
 * SERP — they stay because AI Overviews and the LLM retrievers that now send a
 * meaningful share of developer traffic parse them, and the questions on Home
 * and Pricing are the ones people actually ask.
 */
import { absoluteUrl, REPO_URL, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from './site.ts'

export type JsonLdNode = Record<string, unknown>

const ORG_ID = `${SITE_URL}/#organization`
const SITE_ID = `${SITE_URL}/#website`

export const organizationSchema = (): JsonLdNode => ({
  '@type': 'Organization',
  '@id': ORG_ID,
  name: SITE_NAME,
  url: `${SITE_URL}/`,
  description: SITE_DESCRIPTION,
  logo: absoluteUrl('/og/default.png'),
  sameAs: [REPO_URL],
})

export const webSiteSchema = (): JsonLdNode => ({
  '@type': 'WebSite',
  '@id': SITE_ID,
  name: SITE_NAME,
  url: `${SITE_URL}/`,
  description: SITE_DESCRIPTION,
  publisher: { '@id': ORG_ID },
  inLanguage: 'en',
  // The docs page reads `?q=` and filters its own section index, so this
  // target resolves to a real search rather than a decorative claim.
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${SITE_URL}/docs?q={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
})

/**
 * `offers` is price 0 because the software genuinely is: MailySend bills
 * nothing and the Cloudflare charges are a third party's, which `offers` has
 * no way to express and would misstate if it tried.
 */
export const softwareApplicationSchema = (): JsonLdNode => ({
  '@type': 'SoftwareApplication',
  name: SITE_NAME,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Cloudflare Workers, Node.js 22+',
  url: `${SITE_URL}/`,
  description: SITE_DESCRIPTION,
  license: 'https://opensource.org/licenses/MIT',
  publisher: { '@id': ORG_ID },
  offers: {
    '@type': 'Offer',
    price: 0,
    priceCurrency: 'USD',
    availability: 'https://schema.org/InStock',
  },
})

export interface Crumb {
  name: string
  path: string
}

/** Every page below the root carries one. The root itself is the first item. */
export const breadcrumbSchema = (crumbs: Crumb[]): JsonLdNode => ({
  '@type': 'BreadcrumbList',
  itemListElement: [{ name: 'Home', path: '/' }, ...crumbs].map((crumb, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: crumb.name,
    item: absoluteUrl(crumb.path),
  })),
})

export interface FaqEntry {
  question: string
  /** Plain text. Markup here is stripped by every consumer anyway. */
  answer: string
}

export const faqPageSchema = (entries: FaqEntry[]): JsonLdNode => ({
  '@type': 'FAQPage',
  mainEntity: entries.map((entry) => ({
    '@type': 'Question',
    name: entry.question,
    acceptedAnswer: { '@type': 'Answer', text: entry.answer },
  })),
})

export interface TechArticleEntry {
  /** The section's `id`, which is also its deep anchor. */
  anchor: string
  headline: string
  description: string
}

/**
 * One node per docs section rather than one for the page: the sections are the
 * unit people link to and the unit a retriever quotes, and each has its own
 * stable anchor to point at.
 */
export const techArticleSchemas = (path: string, entries: TechArticleEntry[]): JsonLdNode[] =>
  entries.map((entry) => ({
    '@type': 'TechArticle',
    '@id': absoluteUrl(`${path}#${entry.anchor}`),
    url: absoluteUrl(`${path}#${entry.anchor}`),
    headline: entry.headline,
    description: entry.description,
    isPartOf: { '@id': SITE_ID },
    publisher: { '@id': ORG_ID },
    inLanguage: 'en',
  }))

export interface NoteEntry {
  anchor: string
  headline: string
  description: string
  section: string
  datePublished: string
}

export const blogPostingSchemas = (path: string, entries: NoteEntry[]): JsonLdNode[] =>
  entries.map((entry) => ({
    '@type': 'BlogPosting',
    '@id': absoluteUrl(`${path}#${entry.anchor}`),
    url: absoluteUrl(`${path}#${entry.anchor}`),
    headline: entry.headline,
    description: entry.description,
    articleSection: entry.section,
    datePublished: entry.datePublished,
    author: { '@id': ORG_ID },
    publisher: { '@id': ORG_ID },
    inLanguage: 'en',
  }))

/** Wraps the nodes of one page into a single `@graph`, which is one script tag. */
export const graph = (nodes: JsonLdNode[]): JsonLdNode => ({
  '@context': 'https://schema.org',
  '@graph': nodes,
})
