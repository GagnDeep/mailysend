import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'

export interface StepCardProps {
  /** Rendered zero-padded in the tile variants: `01`, `02`, … */
  step: number
  title: ReactNode
  description?: ReactNode
  /** The right-hand duration hint on the home "how it works" cards. */
  meta?: ReactNode
  children?: ReactNode
  variant?: 'rule' | 'tile' | 'tile-dark' | 'tile-highlight'
  className?: string
}

const pad = (n: number): string => String(n).padStart(2, '0')

export const StepCard = ({
  step,
  title,
  description,
  meta,
  children,
  variant = 'tile',
  className,
}: StepCardProps) => {
  if (variant === 'rule') {
    return (
      <div className={cn('border-l-2 border-accent pl-[18px]', className)}>
        <div className="mb-1.5 text-[16px] font-semibold">
          {step} · {title}
        </div>
        {description ? (
          <p className="m-0 text-[14.5px] leading-relaxed text-muted">{description}</p>
        ) : null}
        {children}
      </div>
    )
  }

  const dark = variant === 'tile-dark' || variant === 'tile-highlight'
  return (
    <div
      className={cn(
        'rounded-tile border p-5',
        variant === 'tile' && 'border-line bg-card text-ink',
        variant === 'tile-dark' && 'border-dark-line bg-dark text-paper',
        variant === 'tile-highlight' && 'border-accent bg-dark-2 text-paper',
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span
          className={cn(
            'font-mono text-[12px] font-bold',
            dark ? 'text-accent-on-dark' : 'text-accent',
          )}
        >
          {pad(step)}
        </span>
        {meta ? <span className="font-mono text-[11px] text-muted-2">{meta}</span> : null}
      </div>
      <div className="mb-1.5 text-[16px] font-semibold -tracking-[0.01em]">{title}</div>
      {description ? (
        <p className={cn('m-0 text-[14px] leading-[1.6]', dark ? 'text-on-dark-3' : 'text-muted')}>
          {description}
        </p>
      ) : null}
      {children}
    </div>
  )
}
