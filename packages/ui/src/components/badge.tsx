import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/cn.ts'

export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap font-mono transition-colors duration-[0.18s]',
  {
    variants: {
      variant: {
        neutral: 'bg-tint text-muted',
        accent: 'bg-accent-soft text-accent border border-accent-border',
        positive: 'bg-positive-bg text-positive',
        danger: 'border border-accent-border bg-accent-soft text-warning',
        ink: 'bg-ink text-paper',
        outline: 'border border-line bg-card text-muted',
      },
      size: {
        sm: 'rounded-chip px-2 py-1 text-[11px] tracking-[0.1em]',
        md: 'rounded-[7px] px-2.5 py-1.5 text-[11.5px]',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant, size }), className)} {...props} />
  ),
)
Badge.displayName = 'Badge'
