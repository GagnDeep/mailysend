import type { TextareaHTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/cn.ts'

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-24 w-full rounded-md border border-line bg-card px-3.5 py-2.5 text-[15px] text-ink',
        'placeholder:text-muted-2 transition-colors duration-[0.18s]',
        'hover:border-muted-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-warning',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
