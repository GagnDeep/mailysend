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
        {/* Indexed, because a chord can repeat a key — `G G` opens agents —
            and keying on the character itself made React drop the second cap. */}
        {keys.map((key, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity here
          <Kbd key={`${key}-${index}`} className={className} {...props}>
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
