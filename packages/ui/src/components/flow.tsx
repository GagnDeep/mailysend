import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn.ts'

export type FlowTone = 'paper' | 'dark' | 'danger' | 'accent'

export interface FlowNodeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** The mono kicker: `TRIGGER`, `WORKERS`, `QUEUES`, `BRANCH`. */
  kicker?: ReactNode
  title: ReactNode
  meta?: ReactNode
  tone?: FlowTone
}

/**
 * A box in the architecture and automation diagrams. Rendered as a list of
 * boxes and arrows rather than an SVG so the diagram stays readable at any
 * width, reflows on a phone, and can be read out in order.
 */
export const FlowNode = ({
  kicker,
  title,
  meta,
  tone = 'paper',
  className,
  ...props
}: FlowNodeProps) => (
  <div
    className={cn(
      'min-w-0 rounded-tile border p-4',
      tone === 'paper' && 'border-line-soft bg-card text-ink',
      tone === 'dark' && 'border-dark-line bg-dark text-on-dark',
      tone === 'danger' && 'border-accent-border bg-accent-soft text-ink',
      tone === 'accent' && 'border-accent bg-dark-2 text-on-dark',
      className,
    )}
    {...props}
  >
    {kicker ? (
      <div
        className={cn(
          'mb-1.5 font-mono text-[11px] tracking-[0.1em]',
          tone === 'paper' && 'text-accent',
          tone === 'dark' && 'text-accent-on-dark',
          tone === 'danger' && 'text-warning',
          tone === 'accent' && 'text-accent-on-dark',
        )}
      >
        {kicker}
      </div>
    ) : null}
    <div className="text-[15px] font-semibold">{title}</div>
    {meta ? (
      <div
        className={cn(
          'mt-1 text-[13.5px] leading-snug',
          tone === 'dark' || tone === 'accent' ? 'text-on-dark-2' : 'text-muted',
        )}
      >
        {meta}
      </div>
    ) : null}
  </div>
)

export interface FlowConnectorProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'vertical' | 'horizontal'
  /** Draws the `↓` / `→` glyph the architecture diagram uses instead of a rule. */
  arrow?: boolean
  tone?: 'paper' | 'dark'
  length?: number
  /** Indents a vertical connector to line up with a node's number gutter. */
  inset?: number
}

export const FlowConnector = ({
  orientation = 'vertical',
  arrow = false,
  tone = 'paper',
  length = 22,
  inset = 0,
  className,
  ...props
}: FlowConnectorProps) => {
  if (arrow) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          'text-center font-mono text-[12px]',
          tone === 'paper' ? 'text-muted-3' : 'text-on-dark-5',
          className,
        )}
        {...props}
      >
        {orientation === 'vertical' ? '↓' : '→'}
      </div>
    )
  }
  return (
    <div
      aria-hidden="true"
      className={cn(tone === 'paper' ? 'bg-line' : 'bg-dark-line', className)}
      style={
        orientation === 'vertical'
          ? { width: 2, height: length, marginLeft: inset }
          : { height: 2, width: length, marginTop: inset }
      }
      {...props}
    />
  )
}
