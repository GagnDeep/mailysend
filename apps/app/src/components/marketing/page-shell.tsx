import { cn } from '@mailysend/ui'
import type { ReactNode } from 'react'
import { SiteFooter } from './site-footer.tsx'
import { SiteNav } from './site-nav.tsx'

export interface PageShellProps {
  children: ReactNode
  /** Sign-in and sign-up are their own full-bleed layouts, with no site chrome. */
  chrome?: boolean
  className?: string
}

/**
 * Nav, `<main>`, footer. The artboards wrap every page in anonymous `<div>`s,
 * which leaves a screen-reader user with no landmark to skip the navigation
 * with — the single most-used shortcut on a long documentation page.
 */
export const PageShell = ({ children, chrome = true, className }: PageShellProps) => (
  <>
    <a
      href="#main"
      className="sr-only rounded-pill bg-ink px-4 py-2 text-paper focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[60]"
    >
      Skip to content
    </a>
    {chrome ? <SiteNav /> : null}
    <main id="main" className={cn('min-w-0', className)}>
      {children}
    </main>
    {chrome ? <SiteFooter /> : null}
  </>
)

export interface SectionProps {
  id?: string
  children: ReactNode
  /** Full-bleed background bands need the padding outside the container. */
  tone?: 'paper' | 'card' | 'dark'
  width?: 'site' | 'prose'
  className?: string
  innerClassName?: string
}

/** The `max-w-site` section wrapper every page repeats a dozen times. */
export const Section = ({
  id,
  children,
  tone = 'paper',
  width = 'site',
  className,
  innerClassName,
}: SectionProps) => (
  <section
    id={id}
    className={cn(
      tone === 'card' && 'border-y border-line bg-card',
      tone === 'dark' && 'bg-ink text-paper',
      className,
    )}
  >
    <div
      className={cn(
        'mx-auto w-full px-6',
        width === 'site' ? 'max-w-site' : 'max-w-[840px]',
        innerClassName,
      )}
    >
      {children}
    </div>
  </section>
)
