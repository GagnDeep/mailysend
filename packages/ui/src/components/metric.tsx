import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn.ts'

export interface MetricProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  value: ReactNode
  label: ReactNode
  /** Places the label before the number, as in the "short version" strip. */
  inline?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const valueSize = { sm: 'text-[22px]', md: 'text-[30px]', lg: 'text-[44px]' } as const

/** A number and what it counts. `StatTile` is this plus a card and a delta. */
export const Metric = ({
  value,
  label,
  inline = false,
  size = 'md',
  className,
  ...props
}: MetricProps) => (
  <div className={cn(inline ? 'flex items-baseline gap-2' : 'min-w-0', className)} {...props}>
    <span className={cn('ms-num font-display font-medium -tracking-[0.035em]', valueSize[size])}>
      {value}
    </span>
    <span className={cn('text-[14px] text-muted', !inline && 'mt-1 block')}>{label}</span>
  </div>
)

export interface MetricGridProps extends HTMLAttributes<HTMLDivElement> {
  /** Narrowest a column may get before the grid wraps. */
  min?: number
}

export const MetricGrid = ({ className, min = 150, style, ...props }: MetricGridProps) => (
  <div
    className={cn('grid gap-3', className)}
    style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, ...style }}
    {...props}
  />
)
