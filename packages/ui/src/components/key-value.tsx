import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn.ts'

export interface KeyValueProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label: ReactNode
  value: ReactNode
  /** The identifier columns are mono; the prose ones are not. */
  mono?: boolean
  intent?: 'default' | 'positive' | 'negative' | 'muted'
  /** Fills the gap between key and value with a hairline. */
  rule?: boolean
}

const intents = {
  default: 'text-ink',
  positive: 'text-positive',
  negative: 'text-warning',
  muted: 'text-muted-2',
} as const

/**
 * One row of a definition list. Rendered as `dt`/`dd` inside a `dl` so a
 * screen reader pairs the label with its value; the artboards use two spans in
 * a flex row, which reads as four unrelated words.
 */
export const KeyValue = ({
  label,
  value,
  mono = false,
  intent = 'default',
  rule = false,
  className,
  ...props
}: KeyValueProps) => (
  <div
    className={cn('flex items-baseline justify-between gap-3 text-[14px]', className)}
    {...props}
  >
    <dt className="min-w-0 shrink truncate text-muted">{label}</dt>
    {rule ? <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-line-soft" /> : null}
    <dd
      className={cn(
        'ms-num m-0 shrink-0 text-right',
        mono && 'font-mono text-[12.5px]',
        intents[intent],
      )}
    >
      {value}
    </dd>
  </div>
)

export const KeyValueList = ({ className, ...props }: HTMLAttributes<HTMLDListElement>) => (
  <dl className={cn('m-0 flex flex-col gap-2', className)} {...props} />
)
