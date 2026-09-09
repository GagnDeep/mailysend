import type { HTMLAttributes } from 'react'
import { cn } from '../lib/cn.ts'

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /** Renders each key of a chord as its own cap: `keys={['G', 'L']}`. */
  keys?: string[]
}

export const Kbd = ({ className, keys, children, ...props }: KbdProps) => {
  if (keys) {
    return (
      <span className="inline-flex items-center gap-1">
        {keys.map((key) => (
          <Kbd key={key} className={className} {...props}>
            {key}
          </Kbd>
        ))}
      </span>
    )
  }
  return (
    <kbd
      className={cn(
        'inline-flex min-w-6 items-center justify-center rounded-chip border border-line bg-tint',
        'px-1.5 py-0.5 font-mono text-[11.5px] text-muted',
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  )
}
