import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  Callout,
  CTABand,
  cn,
  MonoChip,
} from '@mailysend/ui'
import type { ReactNode } from 'react'
import type { GuideMeta } from '~/content/guides/manifest.ts'
import { GUIDES } from '~/content/site-map.ts'
import { DEPLOY_URL } from '~/seo'
import { Faq } from './faq.tsx'
import { GuideCard } from './guide-card.tsx'
import { PageShell, Section } from './page-shell.tsx'
import { AnchorSection } from './prose.tsx'

/**
 * The frame every guide is rendered in.
 *
 * The brief for this surface was that a reader must never feel lost or
 * overwhelmed, which is a checklist rather than an adjective. Every guide gets,
 * in this order: breadcrumbs saying where they are; the category, level,
 * reading time and last-updated date so they can decide before committing; a
 * "You'll need" box that links every prerequisite rather than assuming it; a
 * table of contents that is visible the whole way down on a wide screen and
 * sits at the top on a narrow one; numbered sections so progress is countable;
 * a "what just happened" summary; the FAQ; and two or three specific next
 * guides — never a dead end.
 *
 * `children` is keyed by anchor rather than being a flat list, so the sections
 * render in manifest order and a body written for an anchor that no longer
 * exists cannot silently disappear from the page: it is a missing key, which
 * `guides.routes.test.ts` catches.
 */
export interface GuideLayoutProps {
  guide: GuideMeta
  /** One entry per `guide.sections` anchor. */
  children: Record<string, ReactNode>
  /**
   * The "what just happened" recap, rendered before the FAQ. Prose, not a list
   * of links — the point is to let a reader confirm they got the right outcome.
   */
  summary: ReactNode
}

const prettyDate = (iso: string): string => {
  const [year, month, day] = iso.split('-')
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  return `${Number(day)} ${months[Number(month) - 1]} ${year}`
}

/**
 * The table of contents.
 *
 * Rendered twice — once sticky in the sidebar, once inline above the body on
 * narrow screens — from the same array, because a mobile reader needs the map
 * more than a desktop one does, not less.
 */
const GuideToc = ({ guide, className }: { guide: GuideMeta; className?: string }) => (
  <nav aria-label={`Contents of ${guide.title}`} className={className}>
    <div className="ms-eyebrow mb-2 px-2 text-[10.5px]">ON THIS PAGE</div>
    <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
      {guide.sections.map((section, index) => (
        <li key={section.anchor}>
          <a
            href={`#${section.anchor}`}
            className="flex items-baseline gap-2.5 rounded-sm px-2 py-1.5 text-[14px] text-muted no-underline hover:bg-tint hover:text-ink"
          >
            <span className="font-mono text-[11px] text-muted-2">
              {String(index + 1).padStart(2, '0')}
            </span>
            {section.label}
          </a>
        </li>
      ))}
      <li>
        <a
          href="#faq"
          className="flex items-baseline gap-2.5 rounded-sm px-2 py-1.5 text-[14px] text-muted no-underline hover:bg-tint hover:text-ink"
        >
          <span className="font-mono text-[11px] text-muted-2">FAQ</span>
          Common questions
        </a>
      </li>
    </ol>
  </nav>
)

export const GuideLayout = ({ guide, children, summary }: GuideLayoutProps) => {
  const related = guide.related
    .map((slug) => GUIDES.find((candidate) => candidate.slug === slug))
    .filter((candidate): candidate is GuideMeta => Boolean(candidate))

  return (
    <PageShell>
      <div className="ms-container pt-9">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbItem aria-hidden="true">/</BreadcrumbItem>
            <BreadcrumbItem>
              <BreadcrumbLink href="/guides">Guides</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbItem aria-hidden="true">/</BreadcrumbItem>
            <BreadcrumbItem>
              <BreadcrumbPage>{guide.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <h1 className="ms-display-1 mt-4 mb-3 max-w-[24ch]">{guide.title}</h1>
        <p className="m-0 max-w-[68ch] text-[17.5px] leading-[1.6] text-muted">
          {guide.description}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <MonoChip tone="accent" size="sm">
            {guide.category}
          </MonoChip>
          <MonoChip size="sm">{guide.level}</MonoChip>
          <MonoChip size="sm">{guide.minutes} min read</MonoChip>
          {/* A guide with no date is a guide a reader has to guess about. */}
          <span className="font-mono text-[11.5px] text-muted-2">
            Updated <time dateTime={guide.updated}>{prettyDate(guide.updated)}</time>
          </span>
        </div>
      </div>

      <div className="ms-container grid items-start gap-10 pt-8 pb-20 lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)]">
        <aside className="min-w-0 self-start lg:sticky lg:top-[92px]">
          <GuideToc
            guide={guide}
            className="max-h-[calc(100vh-130px)] overflow-y-auto rounded-card border border-line bg-card px-3.5 py-4"
          />
        </aside>

        <article className="flex min-w-0 flex-col gap-14">
          {guide.prerequisites.length > 0 ? (
            <Callout title="YOU'LL NEED">
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[14.5px]">
                {guide.prerequisites.map((item) => (
                  <li key={item.href}>
                    <a href={item.href} className="text-accent underline underline-offset-4">
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </Callout>
          ) : null}

          {/* The sidebar is `lg:` only, so on a phone the map goes here. */}
          <GuideToc
            guide={guide}
            className="rounded-card border border-line bg-card px-3.5 py-4 lg:hidden"
          />

          {guide.sections.map((section, index) => (
            <AnchorSection
              key={section.anchor}
              anchor={section.anchor}
              heading={
                <>
                  <MonoChip size="sm" className="translate-y-[-2px]">
                    {String(index + 1).padStart(2, '0')}
                  </MonoChip>
                  {section.headline}
                </>
              }
            >
              {children[section.anchor]}
            </AnchorSection>
          ))}

          <section
            id="recap"
            className={cn(
              'min-w-0 scroll-mt-[92px] rounded-card border border-line bg-tint p-6',
              'text-[15.5px] leading-[1.65] text-muted',
            )}
          >
            <h2 className="ms-display-3 mt-0 mb-3">What just happened</h2>
            {summary}
          </section>

          <AnchorSection anchor="faq" heading="Common questions">
            <Faq items={guide.faq} />
          </AnchorSection>

          {related.length > 0 ? (
            <section className="min-w-0">
              <h2 className="ms-display-3 mt-0 mb-4">Read next</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {related.map((candidate) => (
                  <GuideCard key={candidate.slug} guide={candidate} />
                ))}
              </div>
            </section>
          ) : null}
        </article>
      </div>

      <Section className="py-16 sm:py-20">
        <CTABand
          eyebrow="YOUR ACCOUNT, YOUR MAIL"
          title="Nothing to sign up for. Just deploy it."
          description="Every guide on this site describes software you run yourself."
          actions={
            <a
              href={DEPLOY_URL}
              rel="noreferrer"
              className="rounded-pill bg-paper px-5 py-3 text-[14.5px] font-semibold text-ink no-underline"
            >
              Deploy to Cloudflare
            </a>
          }
        />
      </Section>
    </PageShell>
  )
}
