import * as ProgressPrimitive from '@radix-ui/react-progress'
import type { ComponentPropsWithoutRef, ElementRef } from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/cn.ts'

export interface ProgressProps extends ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  tone?: 'accent' | 'positive' | 'ink' | 'neutral'
}

const fills = {
  accent: 'bg-accent',
  positive: 'bg-positive',
  ink: 'bg-ink',
  neutral: 'bg-neutral-bar',
} as const

export const Progress = forwardRef<ElementRef<typeof ProgressPrimitive.Root>, ProgressProps>(
  ({ className, value, tone = 'accent', ...props }, ref) => (
    <ProgressPrimitive.Root
      ref={ref}
      value={value}
      className={cn('relative h-[9px] w-full overflow-hidden rounded-pill bg-line-soft', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn('h-full rounded-pill transition-[width] duration-200', fills[tone])}
        style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }}
      />
    </ProgressPrimitive.Root>
  ),
)
Progress.displayName = 'Progress'
