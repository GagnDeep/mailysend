import type { JsonLdNode } from './schema.ts'
import { graph } from './schema.ts'
import { absoluteUrl, SITE_NAME, SITE_TWITTER } from './site.ts'

/**
 * The shapes TanStack Router accepts in a route's `head()`. `meta` entries are
 * typed as `<meta>` props, which is why the JSON-LD entry — a key the router
 * special-cases into a `<script type="application/ld+json">` — needs the cast
 * in `jsonLdTag` rather than being expressible directly.
 */
type MetaTag = NonNullable<React.JSX.IntrinsicElements['meta']>
type LinkTag = NonNullable<React.JSX.IntrinsicElements['link']>

/**
 * The router escapes `<` inside this entry before it reaches the document,
 * which is what keeps a `</script>` in any string field from ending the block
 * early. Emitting the same JSON through `head.scripts` would not be escaped.
 */
const jsonLdTag = (nodes: JsonLdNode[]): MetaTag =>
  ({ 'script:ld+json': graph(nodes) }) as unknown as MetaTag

export interface PageHeadInput {
  /** Without the site name — `pageHead` appends it. */
  title: string
  description: string
  /** Site-relative, no trailing slash except the root. Becomes the canonical. */
  path: string
  /** Site-relative path to the 1200×630 card. */
  image?: string
  ogType?: 'website' | 'article'
  /** `noindex` for pages that exist for humans mid-flow, not for the index. */
  noindex?: boolean
  jsonLd?: JsonLdNode[]
}

export interface PageHead {
  meta: MetaTag[]
  links: LinkTag[]
}

/**
 * One place that decides what a page's head contains, because the failure mode
 * of per-route hand-written tags is a page that quietly ships without a
 * canonical or with an OG title that no longer matches the H1.
 */
export const pageHead = ({
  title,
  description,
  path,
  image = '/og/default.png',
  ogType = 'website',
  noindex = false,
  jsonLd,
}: PageHeadInput): PageHead => {
  const url = absoluteUrl(path)
  const fullTitle = title === SITE_NAME ? title : `${title} · ${SITE_NAME}`
  const imageUrl = absoluteUrl(image)

  const meta: MetaTag[] = [
    { title: fullTitle },
    { name: 'description', content: description },
    { property: 'og:type', content: ogType },
    { property: 'og:site_name', content: SITE_NAME },
    { property: 'og:title', content: fullTitle },
    { property: 'og:description', content: description },
    { property: 'og:url', content: url },
    { property: 'og:image', content: imageUrl },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:image:alt', content: title },
    { property: 'og:locale', content: 'en_US' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:site', content: SITE_TWITTER },
    { name: 'twitter:title', content: fullTitle },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: imageUrl },
  ]

  if (noindex) meta.push({ name: 'robots', content: 'noindex, follow' })
  if (jsonLd?.length) meta.push(jsonLdTag(jsonLd))

  return { meta, links: [{ rel: 'canonical', href: url }] }
}

/**
 * The head for a dashboard screen.
 *
 * Deliberately not `pageHead`: none of it belongs in an index, so there is no
 * canonical, no OG card and no JSON-LD — a share of `/app/logs` should show a
 * bare link, not a card advertising somebody's private message log. What it
 * does give is a real, distinct `<title>`, which is what a person with nine
 * dashboard tabs open is actually navigating by.
 */
export const appHead = (title: string): PageHead => ({
  meta: [{ title: `${title} · ${SITE_NAME}` }, { name: 'robots', content: 'noindex, nofollow' }],
  links: [],
})
