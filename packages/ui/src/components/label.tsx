import * as LabelPrimitive from '@radix-ui/react-label'
import type { ComponentPropsWithoutRef, ElementRef } from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/cn.ts'

export interface LabelProps extends ComponentPropsWithoutRef<typeof LabelPrimitive.Root> {
  /** Renders the muted `optional` marker the forms in SignUp use. */
  optional?: boolean
}

/**
 * `htmlFor` is required, not optional. Radix's label will also associate by
 * nesting, but every form in the design puts the label above a sibling input,
 * where nesting is not available and a missing `htmlFor` silently produces an
 * unlabelled field.
 */
export const Label = forwardRef<
  ElementRef<typeof LabelPrimitive.Root>,
  LabelProps & { htmlFor: string }
>(({ className, optional, children, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'flex items-center gap-2 text-[13.5px] font-semibold text-ink',
      'peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
      className,
    )}
    {...props}
  >
    {children}
    {optional ? (
      <span className="font-mono text-[11px] font-normal text-muted-2">optional</span>
    ) : null}
  </LabelPrimitive.Root>
))
Label.displayName = 'Label'
