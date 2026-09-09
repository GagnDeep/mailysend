import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'

export interface CTABandProps {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** The buttons. Right-hand column when `layout="split"`. */
  actions?: ReactNode
  /** Small print under the actions. */
  footnote?: ReactNode
  tone?: 'dark' | 'paper'
  layout?: 'split' | 'center'
  className?: string
}

/**
 * The closing band. `rounded-block` rather than a true full-bleed edge: the
 * design insets it inside the 1200px container on every page it appears on.
 */
export const CTABand = ({
  eyebrow,
  title,
  description,
  actions,
  footnote,
  tone = 'dark',
  layout = 'split',
  className,
}: CTABandProps) => (
  <div
    className={cn(
      'rounded-block p-[clamp(28px,4vw,48px)]',
      tone === 'dark' ? 'bg-ink text-paper' : 'border border-line bg-card text-ink',
      layout === 'split'
        ? 'grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] items-center gap-8'
        : 'text-center',
      className,
    )}
  >
    <div className="min-w-0">
      {eyebrow ? (
        <div className={cn('ms-eyebrow mb-3.5', tone === 'dark' && 'text-accent-on-dark')}>
          {eyebrow}
        </div>
      ) : null}
      <h2 className="ms-display-2">{title}</h2>
      {description ? (
        <p
          className={cn(
            'mt-3.5 text-[16.5px] leading-[1.6]',
            layout === 'center' ? 'mx-auto max-w-[52ch]' : 'max-w-[46ch]',
            tone === 'dark' ? 'text-on-dark-3' : 'text-muted',
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
    {actions ? (
      <div
        className={cn(
          'flex min-w-0 flex-wrap gap-3',
          layout === 'split' ? 'flex-col items-start' : 'mt-6 justify-center',
        )}
      >
        {actions}
        {footnote ? (
          <div
            className={cn(
              'mt-1.5 text-[13px]',
              tone === 'dark' ? 'text-on-dark-4' : 'text-muted-2',
            )}
          >
            {footnote}
          </div>
        ) : null}
      </div>
    ) : null}
  </div>
)
