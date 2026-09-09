import type { InputHTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/cn.ts'

export type InputProps = InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type ?? 'text'}
      className={cn(
        'flex h-11 w-full rounded-md border border-line bg-card px-3.5 py-2 text-[15px] text-ink',
        'placeholder:text-muted-2 transition-colors duration-[0.18s]',
        'hover:border-muted-3 disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink',
        'aria-invalid:border-warning',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
