import { Input, Label, MonoChip } from '@mailysend/ui'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { GuideCard } from '~/components/marketing/guide-card.tsx'
import { PageShell, Section } from '~/components/marketing/page-shell.tsx'
import type { GuideCategory, GuideMeta } from '~/content/guides/manifest.ts'
import { GUIDES } from '~/content/site-map.ts'
import { breadcrumbSchema, pageHead } from '~/seo'

/**
 * The guides index.
 *
 * Grouped by track rather than listed alphabetically, with a "start here" rail
 * at the top: twenty-six cards in one flat grid is the definition of
 * overwhelming, and the whole point of this surface is that a reader always
 * knows where they are and what comes next.
 *
 * The `?q=` filter behaves exactly as the one on /docs does — same interaction,
 * same live count, same one-click way back — and `robots.txt` already carries
 * `Disallow: /*?q=`, so it needs no new crawl policy.
 */
const TRACKS: Array<{ category: GuideCategory; lede: string }> = [
  {
    category: 'Deploy',
    lede: 'Getting an instance running, claimed, and pointed at a way to send.',
  },
  {
    category: 'Deliverability',
    lede: 'The part that decides whether any of the rest of it matters.',
  },
  { category: 'Sending', lede: 'The transactional path: one message, a batch, a template.' },
  { category: 'Receiving', lede: 'Inbound mail, and reading a rejection.' },
  { category: 'Marketing', lede: 'Segments, broadcasts, automations and the exit link.' },
  { category: 'Platform', lede: 'Webhooks, keys, agents, cost, and moving in.' },
]

/** The four a first-time reader should do in order, before anything else. */
const START_HERE = [
  'deploy-to-cloudflare',
  'claim-your-instance',
  'verify-a-sending-domain',
  'send-your-first-email',
]

export const Route = createFileRoute('/guides/')({
  validateSearch: (search: Record<string, unknown>): { q?: string } => {
    const q = typeof search.q === 'string' ? search.q.trim() : ''
    return q ? { q } : {}
  },
  head: () =>
    pageHead({
      title: 'Guides',
      description:
        'Twenty-six task-shaped guides to running your own email platform: deploying, DNS and DMARC, ' +
        'deliverability, sending, inbound mail, segments, broadcasts, webhooks and cost — several of ' +
        'them running the product’s own code in the page.',
      path: '/guides',
      image: '/og/docs.png',
      jsonLd: [breadcrumbSchema([{ name: 'Guides', path: '/guides' }])],
    }),
  component: GuidesIndex,
})

const matches = (guide: GuideMeta, needle: string) =>
  guide.title.toLowerCase().includes(needle) ||
  guide.description.toLowerCase().includes(needle) ||
  guide.category.toLowerCase().includes(needle) ||
  guide.sections.some(
    (section) =>
      section.label.toLowerCase().includes(needle) ||
      section.description.toLowerCase().includes(needle),
  )

function GuidesIndex() {
  const { q } = Route.useSearch()
  const [query, setQuery] = useState(q ?? '')
  const needle = query.trim().toLowerCase()
  const visible = needle ? GUIDES.filter((guide) => matches(guide, needle)) : GUIDES

  const startHere = START_HERE.map((slug) => GUIDES.find((guide) => guide.slug === slug)).filter(
    (guide): guide is GuideMeta => Boolean(guide),
  )

  return (
    <PageShell>
      <div className="ms-container pt-11">
        <p className="ms-eyebrow m-0 text-[11.5px]">GUIDES · {GUIDES.length} · MIT LICENSED</p>
        <h1 className="ms-display-1 mt-3.5 mb-3">Guides</h1>
        <p className="m-0 max-w-[68ch] text-[17.5px] leading-[1.6] text-muted">
          Task-shaped, in the order you actually hit them. Where a guide explains a rule the product
          enforces — how a bounce is classified, what a segment compiles to, what a hundred thousand
          emails cost — the page imports the real function and shows you its real answer, rather
          than restating it in prose that would drift.
        </p>
      </div>

      <Section className="pt-9">
        <div className="rounded-card border border-line bg-tint p-5 sm:p-6">
          <div className="ms-eyebrow mb-1 text-[10.5px]">START HERE</div>
          <p className="mt-0 mb-4 max-w-[62ch] text-[14.5px] leading-[1.6] text-muted">
            Four guides, in order. At the end of them you have an instance you own, a domain that
            authenticates, and a delivered message.
          </p>
          <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {startHere.map((guide, index) => (
              <li key={guide.slug} className="relative">
                <MonoChip
                  size="sm"
                  tone="ink"
                  className="absolute top-3 right-3 z-10 tracking-[0.1em]"
                >
                  {index + 1}
                </MonoChip>
                <GuideCard guide={guide} />
              </li>
            ))}
          </ol>
        </div>
      </Section>

      <Section className="pt-10 pb-20">
        <div className="mb-8 max-w-[420px]">
          <Label htmlFor="guides-filter" className="sr-only">
            Filter guides
          </Label>
          <Input
            id="guides-filter"
            type="search"
            value={query}
            placeholder="Filter guides — try “dmarc”, “bounce”, “cost”"
            onChange={(event) => setQuery(event.target.value)}
            className="h-10"
          />
          {needle ? (
            <div className="mt-2 flex items-center justify-between gap-2 text-[12.5px] text-muted-2">
              {/* A filter that silently empties the page is a dead end, so the
                  count is stated and the way back is one click. */}
              <span aria-live="polite">
                {visible.length} of {GUIDES.length} guides
              </span>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="rounded-chip px-1.5 py-0.5 text-accent hover:bg-tint"
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>

        {visible.length === 0 ? (
          <p className="text-[15px] text-muted">
            Nothing matches “{query}”.{' '}
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-accent underline underline-offset-4"
            >
              Show all {GUIDES.length}
            </button>
            , or try the{' '}
            <a href="/docs" className="text-accent underline underline-offset-4">
              API reference
            </a>
            .
          </p>
        ) : (
          <div className="flex flex-col gap-12">
            {TRACKS.map((track) => {
              const items = visible.filter((guide) => guide.category === track.category)
              if (items.length === 0) return null
              return (
                <section key={track.category}>
                  <div className="mb-4 flex flex-wrap items-baseline gap-3">
                    <h2 className="ms-display-3 m-0">{track.category}</h2>
                    <span className="font-mono text-[11.5px] text-muted-2">
                      {items.length} guide{items.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="mt-0 mb-5 max-w-[62ch] text-[15px] leading-[1.6] text-muted">
                    {track.lede}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((guide) => (
                      <GuideCard key={guide.slug} guide={guide} />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </Section>
    </PageShell>
  )
}
