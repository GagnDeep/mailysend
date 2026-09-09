import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/cn.ts'

export const monoChipVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap font-mono transition-colors duration-[0.18s]',
  {
    variants: {
      tone: {
        neutral: 'bg-tint text-muted',
        accent: 'bg-accent-soft text-accent',
        positive: 'bg-positive-bg text-positive',
        warning: 'bg-accent-soft text-warning',
        ink: 'bg-ink text-paper',
      },
      size: {
        sm: 'rounded-chip px-2 py-1 text-[11px]',
        md: 'rounded-[7px] px-2.5 py-1.5 text-[11.5px]',
        lg: 'rounded-sm px-3 py-[7px] text-[12px]',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
)

export interface MonoChipProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof monoChipVariants> {}

/** The small mono pill used for endpoint names, event names, tags and filters. */
export const MonoChip = forwardRef<HTMLSpanElement, MonoChipProps>(
  ({ className, tone, size, ...props }, ref) => (
    <span ref={ref} className={cn(monoChipVariants({ tone, size }), className)} {...props} />
  ),
)
MonoChip.displayName = 'MonoChip'
