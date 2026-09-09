import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import { Eyebrow } from './eyebrow.tsx'

export type DeltaDirection = 'up' | 'down' | 'flat'

export interface StatTileProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label: ReactNode
  value: ReactNode
  /** Trailing unit set at reading size beside the display number, e.g. `/mo`. */
  unit?: ReactNode
  delta?: ReactNode
  /**
   * Which way is good. `up` is not automatically positive — a rising bounce
   * rate is the worst number on the page — so the caller states the meaning
   * and `intent` decides the colour.
   */
  direction?: DeltaDirection
  intent?: 'positive' | 'negative' | 'neutral'
  tone?: 'paper' | 'alert' | 'dark' | 'dark-accent'
}

const deltaClass = {
  positive: 'text-positive',
  negative: 'text-warning',
  neutral: 'text-muted',
} as const

const arrow = { up: '↑', down: '↓', flat: '·' } as const

export const StatTile = ({
  label,
  value,
  unit,
  delta,
  direction,
  intent = 'neutral',
  tone = 'paper',
  className,
  ...props
}: StatTileProps) => (
  <div
    className={cn(
      'rounded-tile border p-4',
      tone === 'paper' && 'border-line-soft bg-card',
      tone === 'alert' && 'border-line-soft bg-accent-soft',
      tone === 'dark' && 'border-dark-line bg-dark text-on-dark',
      tone === 'dark-accent' && 'border-accent bg-dark-2 text-on-dark',
      className,
    )}
    {...props}
  >
    <Eyebrow
      wide
      className={cn(
        'text-[10.5px]',
        tone === 'alert' && 'text-warning',
        tone === 'dark-accent' && 'text-accent-on-dark',
      )}
    >
      {label}
    </Eyebrow>
    <div
      className={cn(
        'ms-num mt-1.5 font-display text-[32px] font-medium -tracking-[0.03em]',
        intent === 'positive' && tone === 'paper' && 'text-positive',
      )}
    >
      {value}
      {unit ? <span className="ml-1 text-[15px] font-normal text-muted-2">{unit}</span> : null}
    </div>
    {delta ? (
      <div
        className={cn(
          'ms-num mt-0.5 text-[12.5px]',
          tone === 'dark' || tone === 'dark-accent' ? 'text-on-dark-3' : deltaClass[intent],
        )}
      >
        {direction ? (
          <span aria-hidden="true" className="mr-1">
            {arrow[direction]}
          </span>
        ) : null}
        {delta}
      </div>
    ) : null}
  </div>
)
