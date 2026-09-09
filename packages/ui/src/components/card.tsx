import type { HTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/cn.ts'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** The inverted card used for the "last" item in every feature grid. */
  tone?: 'paper' | 'dark' | 'tint'
  /** Lifts on hover. Only the linked cards in the artboards do this. */
  interactive?: boolean
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, tone = 'paper', interactive = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-card border',
        tone === 'paper' && 'border-line bg-card text-ink',
        tone === 'tint' && 'border-line bg-tint text-ink',
        tone === 'dark' && 'border-ink bg-ink text-paper',
        interactive &&
          'transition-[transform,box-shadow] duration-200 hover:-translate-y-[3px] hover:shadow-lg',
        className,
      )}
      {...props}
    />
  ),
)
Card.displayName = 'Card'

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1.5 p-6 pb-0', className)} {...props} />
  ),
)
CardHeader.displayName = 'CardHeader'

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-[19px] font-semibold -tracking-[0.01em]', className)}
      {...props}
    />
  ),
)
CardTitle.displayName = 'CardTitle'

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-[14.5px] leading-relaxed text-muted', className)} {...props} />
))
CardDescription.displayName = 'CardDescription'

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-6', className)} {...props} />,
)
CardContent.displayName = 'CardContent'

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center gap-3 p-6 pt-0', className)} {...props} />
  ),
)
CardFooter.displayName = 'CardFooter'
