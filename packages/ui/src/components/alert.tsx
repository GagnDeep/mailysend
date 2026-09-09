import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/cn.ts'

const alertVariants = cva('rounded-code border p-3.5 text-[14px] leading-[1.65]', {
  variants: {
    variant: {
      info: 'border-line bg-card text-muted',
      accent: 'border-accent-border bg-accent-soft text-muted',
      warning: 'border-accent-border bg-accent-soft text-muted',
      success: 'border-positive/25 bg-positive-bg text-muted',
    },
  },
  defaultVariants: { variant: 'info' },
})

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
  ),
)
Alert.displayName = 'Alert'

export const AlertTitle = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn('mb-1 text-[13.5px] font-semibold text-ink', className)}
      {...props}
    />
  ),
)
AlertTitle.displayName = 'AlertTitle'

export const AlertDescription = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-muted', className)} {...props} />
  ),
)
AlertDescription.displayName = 'AlertDescription'
