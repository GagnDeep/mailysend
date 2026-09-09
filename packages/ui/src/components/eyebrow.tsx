import type { ElementType, HTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/cn.ts'

export interface EyebrowProps extends HTMLAttributes<HTMLElement> {
  /** `div` by default; use `span` when the eyebrow sits inline in a header row. */
  as?: ElementType
  /** The wider `.12em` tracking the dashboard tiles use for their labels. */
  wide?: boolean
}

/**
 * The mono kicker above every H2. It is decorative typography, not a heading —
 * marking it up as one would put a phantom level into the document outline
 * between the section heading and its parent.
 */
export const Eyebrow = forwardRef<HTMLElement, EyebrowProps>(
  ({ as: Comp = 'div', className, wide = false, ...props }, ref) => (
    <Comp
      ref={ref}
      className={cn('ms-eyebrow', wide && 'tracking-[0.12em]', className)}
      {...props}
    />
  ),
)
Eyebrow.displayName = 'Eyebrow'
