import { Callout, Eyebrow, MonoChip } from '@mailysend/ui'
import type { ReactNode } from 'react'
import { PageShell, Section } from './page-shell.tsx'

/**
 * The three legal documents share one date on purpose: they were written
 * together and describe one product, so letting them drift apart would make
 * "which version applies" a question nobody can answer.
 */
export const LEGAL_UPDATED = '2026-09-09'

const LEGAL_PAGES = [
  { href: '/legal/privacy', label: 'Privacy' },
  { href: '/legal/terms', label: 'Terms' },
  { href: '/legal/dpa', label: 'Data processing' },
]

export interface LegalPageProps {
  /** Rendered as the page's only `h1`. */
  title: string
  /** One plain-English line saying what the document is, above the fold. */
  summary: string
  href: string
  children: ReactNode
}

/**
 * The shell for a legal document.
 *
 * Narrow measure, real `<article>`, and the disclaimer above the text rather
 * than buried at the bottom — an operator who deploys MailySend inherits these
 * documents as their own, so they need to know that before they read them.
 */
export const LegalPage = ({ title, summary, href, children }: LegalPageProps) => (
  <PageShell>
    <Section width="prose" className="pt-16 pb-10 sm:pt-24">
      <Eyebrow>LEGAL</Eyebrow>
      <h1 className="ms-display-2 mt-4">{title}</h1>
      <p className="mt-5 text-[17px] leading-[1.65] text-muted">{summary}</p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <MonoChip>
          Last updated <time dateTime={LEGAL_UPDATED}>{LEGAL_UPDATED}</time>
        </MonoChip>
        <nav aria-label="Legal documents" className="flex flex-wrap gap-3">
          {LEGAL_PAGES.filter((page) => page.href !== href).map((page) => (
            <a
              key={page.href}
              href={page.href}
              className="text-[14px] font-semibold text-accent underline underline-offset-4 hover:text-ink"
            >
              {page.label}
            </a>
          ))}
        </nav>
      </div>
      <Callout variant="info" title="A template, not legal advice" className="mt-8">
        This document ships with the software as a starting point. MailySend is MIT-licensed code
        you deploy yourself, so if you operate an instance you are the one making these promises —
        review the text against your own jurisdiction and business before publishing it, and fill in
        every bracketed placeholder.
      </Callout>
    </Section>
    <Section width="prose" className="pb-20">
      <article className="flex flex-col gap-10">{children}</article>
    </Section>
  </PageShell>
)

export const LegalSection = ({
  id,
  heading,
  children,
}: {
  id: string
  heading: string
  children: ReactNode
}) => (
  <section id={id} className="scroll-mt-24">
    <h2 className="m-0 text-[22px] font-semibold -tracking-[0.02em] text-ink">{heading}</h2>
    <div className="mt-3 flex flex-col gap-3 text-[15.5px] leading-[1.7] text-muted">
      {children}
    </div>
  </section>
)

/** Bracketed placeholders are visibly unfilled so nobody ships them by accident. */
export const Placeholder = ({ children }: { children: ReactNode }) => (
  <MonoChip tone="warning" size="sm">
    {children}
  </MonoChip>
)

export const LegalList = ({ children }: { children: ReactNode }) => (
  <ul className="m-0 flex list-disc flex-col gap-2 pl-5">{children}</ul>
)
