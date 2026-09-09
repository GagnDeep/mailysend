import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'

export interface AnchorPillItem {
  href: string
  label: ReactNode
  /** The one dark pill at the end of the row — a CTA, not an active state. */
  emphasis?: boolean
}

export interface AnchorPillsProps {
  items: AnchorPillItem[]
  /** `href` of the section currently in view, if the page tracks one. */
  activeHref?: string
  align?: 'start' | 'center'
  label?: string
  className?: string
}

/**
 * The in-page anchor row. It is a `nav` with `aria-current` on the pill whose
 * section is in view; the artboards render it as bare links, which leaves a
 * screen-reader user with no way to tell where they are on a long page.
 */
export const AnchorPills = ({
  items,
  activeHref,
  align = 'center',
  label = 'On this page',
  className,
}: AnchorPillsProps) => (
  <nav
    aria-label={label}
    className={cn('flex flex-wrap gap-2.5', align === 'center' && 'justify-center', className)}
  >
    {items.map((item) => {
      const active = item.href === activeHref
      return (
        <a
          key={item.href}
          href={item.href}
          aria-current={active ? 'true' : undefined}
          className={cn(
            'rounded-pill px-4 py-2.5 text-[14px] font-semibold transition-colors duration-[0.18s]',
            item.emphasis
              ? 'bg-ink text-paper hover:bg-accent'
              : 'border border-line bg-card text-ink hover:border-ink',
            active && !item.emphasis && 'border-accent text-accent',
          )}
        >
          {item.label}
        </a>
      )
    })}
  </nav>
)
