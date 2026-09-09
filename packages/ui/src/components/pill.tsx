import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/cn.ts'

const pillVariants = cva(
  'inline-flex items-center gap-2.5 whitespace-nowrap rounded-pill transition-colors duration-[0.18s]',
  {
    variants: {
      tone: {
        outline: 'border border-line bg-card text-muted',
        ink: 'bg-ink text-paper',
        accent: 'border border-accent-border bg-accent-soft text-accent',
        positive: 'bg-positive-bg text-positive',
      },
      size: {
        sm: 'px-2.5 py-1 text-[11.5px]',
        md: 'px-3.5 py-[7px] text-[11.5px]',
        lg: 'px-4 py-2.5 text-[14px]',
      },
      mono: { true: 'font-mono tracking-[0.08em]', false: '' },
    },
    defaultVariants: { tone: 'outline', size: 'md', mono: true },
  },
)

export interface PillProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pillVariants> {}

/** The rounded capsule used for the hero badge and the live-status marks. */
export const Pill = forwardRef<HTMLSpanElement, PillProps>(
  ({ className, tone, size, mono, ...props }, ref) => (
    <span ref={ref} className={cn(pillVariants({ tone, size, mono }), className)} {...props} />
  ),
)
Pill.displayName = 'Pill'
