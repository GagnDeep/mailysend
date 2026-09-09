import type { HTMLAttributes } from 'react'
import { cn } from '../lib/cn.ts'

export interface HairlineRuleProps extends HTMLAttributes<HTMLSpanElement> {
  soft?: boolean
}

/**
 * The 1px filler that eats the remaining width beside a heading or a log line.
 * Purely decorative, so it is hidden from the accessibility tree rather than
 * exposed as a separator — a separator here would announce a section break that
 * does not exist.
 */
export const HairlineRule = ({ className, soft = false, ...props }: HairlineRuleProps) => (
  <span
    aria-hidden="true"
    className={cn('h-px min-w-4 flex-1', soft ? 'bg-line-soft' : 'bg-line', className)}
    {...props}
  />
)
