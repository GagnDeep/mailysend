import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'

export type BarSeries = 'accent' | 'positive' | 'positive-bright' | 'ink' | 'neutral' | 'amber'

export interface BarRowProps {
  label: ReactNode
  /** 0–100. Clamped, because an API can and will return 100.4. */
  percent: number
  /** The right-hand readout. Falls back to the percentage. */
  value?: ReactNode
  /** `neutral` is the "them" series in every comparison chart. */
  series?: BarSeries
  /** Value text turns red when the number itself is the bad news. */
  valueIntent?: 'default' | 'negative' | 'positive'
  /** `inline` puts the label to the left; `stacked` puts it above the track. */
  layout?: 'inline' | 'stacked'
  labelWidth?: number
  height?: number
  className?: string
}

const fills: Record<BarSeries, string> = {
  accent: 'bg-accent',
  positive: 'bg-positive',
  'positive-bright': 'bg-positive-bright',
  ink: 'bg-ink',
  neutral: 'bg-neutral-bar',
  amber: 'bg-accent-on-dark',
}

const valueTone = {
  default: 'text-muted',
  negative: 'text-warning',
  positive: 'text-positive',
} as const

export const BarRow = ({
  label,
  percent,
  value,
  series = 'accent',
  valueIntent = 'default',
  layout = 'inline',
  labelWidth = 74,
  height = 9,
  className,
}: BarRowProps) => {
  const clamped = Math.min(100, Math.max(0, percent))
  const readout = value ?? `${clamped}%`

  // The label and the readout are already text; a second announcement of the
  // same number from the bar would just be noise.
  const track = (
    <span
      aria-hidden="true"
      className="block flex-1 overflow-hidden rounded-pill bg-line-soft"
      style={{ height }}
    >
      <span
        className={cn('block rounded-pill', fills[series])}
        style={{ width: `${clamped}%`, height }}
      />
    </span>
  )

  if (layout === 'stacked') {
    return (
      <div className={cn('min-w-0', className)}>
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13.5px]">
          <span className="truncate">{label}</span>
          <span className={cn('ms-num shrink-0 font-mono', valueTone[valueIntent])}>{readout}</span>
        </div>
        <span className="flex">{track}</span>
      </div>
    )
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <span className="shrink-0 truncate text-[13.5px]" style={{ width: labelWidth }}>
        {label}
      </span>
      {track}
      <span
        className={cn('ms-num shrink-0 text-right font-mono text-[12px]', valueTone[valueIntent])}
        style={{ width: 52 }}
      >
        {readout}
      </span>
    </div>
  )
}
