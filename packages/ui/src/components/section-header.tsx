import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import { Eyebrow } from './eyebrow.tsx'

export interface SectionHeaderProps {
  eyebrow?: ReactNode
  title: ReactNode
  /** The paragraph under the heading. */
  lede?: ReactNode
  /** The right-hand "All SDK docs →" link every section header in the design has. */
  action?: ReactNode
  /** Which step of the display scale the heading uses. */
  level?: 1 | 2 | 3
  /** `h2` unless the header opens the page. */
  as?: 'h1' | 'h2' | 'h3'
  align?: 'start' | 'center'
  tone?: 'paper' | 'dark'
  className?: string
  id?: string
}

const displayClass = { 1: 'ms-display-1', 2: 'ms-display-2', 3: 'ms-display-3' } as const

export const SectionHeader = ({
  eyebrow,
  title,
  lede,
  action,
  level = 2,
  as: Heading = 'h2',
  align = 'start',
  tone = 'paper',
  className,
  id,
}: SectionHeaderProps) => (
  <div
    className={cn(
      'flex flex-wrap items-end justify-between gap-x-6 gap-y-3',
      align === 'center' && 'flex-col items-center text-center',
      className,
    )}
  >
    <div className={cn('min-w-0', align === 'center' && 'flex flex-col items-center')}>
      {eyebrow ? (
        <Eyebrow className={cn(tone === 'dark' && 'text-accent-on-dark')}>{eyebrow}</Eyebrow>
      ) : null}
      <Heading id={id} className={cn(displayClass[level], eyebrow && 'mt-3.5')}>
        {title}
      </Heading>
      {lede ? (
        <p
          className={cn(
            'mt-4 max-w-[62ch] text-[17px] leading-[1.55]',
            tone === 'dark' ? 'text-on-dark-3' : 'text-muted',
          )}
        >
          {lede}
        </p>
      ) : null}
    </div>
    {action ? <div className="shrink-0">{action}</div> : null}
  </div>
)
