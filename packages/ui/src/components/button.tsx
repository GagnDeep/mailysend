import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/cn.ts'

/**
 * Every button in the design is a pill. There is no square button anywhere in
 * the artboards, so `rounded-pill` lives in the base rather than in a variant.
 * The focus ring is the global `:focus-visible` rule from the theme — nothing
 * here sets `outline-none`.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-pill font-semibold whitespace-nowrap ' +
    'transition-[background-color,color,border-color,transform] duration-[0.18s] ease-out ' +
    'disabled:pointer-events-none disabled:opacity-45 ' +
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-ink text-paper hover:bg-accent hover:-translate-y-px active:translate-y-0',
        accent: 'bg-accent text-white shadow-accent hover:bg-accent-hover hover:-translate-y-px',
        outline: 'bg-card text-ink border border-ink hover:bg-ink hover:text-paper',
        ghost: 'bg-transparent text-muted hover:bg-tint hover:text-ink',
        link: 'bg-transparent text-accent hover:text-ink px-0 rounded-none underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-4 text-[13.5px] [&_svg]:size-3.5',
        md: 'h-11 px-[22px] text-[15px] [&_svg]:size-4',
        lg: 'h-[52px] px-[26px] text-[15.5px] [&_svg]:size-[18px]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        // A button inside a form defaults to `submit`, which is almost never
        // what a toolbar or dialog-header button means.
        type={asChild ? type : (type ?? 'button')}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'
