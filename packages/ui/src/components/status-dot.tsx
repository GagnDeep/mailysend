import type { HTMLAttributes } from 'react'
import { cn } from '../lib/cn.ts'

export type StatusDotTone = 'accent' | 'positive' | 'warning' | 'muted' | 'ink' | 'amber'

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusDotTone
  size?: 6 | 7 | 8
  /**
   * Drives the `ms-pulse` animation. It marks a *live* signal — an open
   * connection, a send in flight — and nothing else; a static "delivered" dot
   * that pulses reads as activity that is not happening. The theme's global
   * `prefers-reduced-motion` block already stops it for users who ask.
   */
  pulse?: boolean
}

const tones: Record<StatusDotTone, string> = {
  accent: 'bg-accent',
  positive: 'bg-positive',
  warning: 'bg-warning',
  muted: 'bg-muted-2',
  ink: 'bg-ink',
  amber: 'bg-accent-on-dark',
}

const sizes = { 6: 'size-1.5', 7: 'size-[7px]', 8: 'size-2' } as const

export const StatusDot = ({
  className,
  tone = 'positive',
  size = 8,
  pulse = false,
  ...props
}: StatusDotProps) => (
  <span
    aria-hidden="true"
    className={cn(
      'inline-block shrink-0 rounded-pill',
      tones[tone],
      sizes[size],
      pulse && 'animate-ms-pulse',
      className,
    )}
    {...props}
  />
)
