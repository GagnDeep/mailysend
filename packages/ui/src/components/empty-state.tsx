import type { ComponentType, ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import { Button } from './button.tsx'

interface EmptyStateAction {
  label: string
  onClick?: () => void
  href?: string
}

export interface EmptyStateProps {
  /** A lucide icon component, or any 20–24px glyph. */
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>
  title: ReactNode
  /** One sentence. If it needs two, the screen is doing too much. */
  description: ReactNode
  /**
   * Required, deliberately.
   *
   * The design's stated rule is that every empty state has one obvious next
   * action and no screen ends in "contact support". Making this optional would
   * make the dead end the path of least resistance, so the type system rules it
   * out instead of a lint rule nobody reads.
   */
  action: EmptyStateAction
  /** A quiet second option — docs, an import, a sample. Never a substitute. */
  secondaryAction?: EmptyStateAction
  className?: string
}

export const EmptyState = ({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) => (
  <div
    className={cn(
      'flex flex-col items-center gap-3 rounded-tile border border-line-soft bg-card px-6 py-12 text-center',
      className,
    )}
  >
    {Icon ? (
      <span className="grid size-11 place-items-center rounded-pill bg-tint text-muted-2">
        <Icon aria-hidden="true" className="size-5" />
      </span>
    ) : null}
    <h3 className="font-display text-[19px] font-medium -tracking-[0.02em]">{title}</h3>
    <p className="m-0 max-w-[46ch] text-[14.5px] leading-[1.6] text-muted">{description}</p>
    <div className="mt-2 flex flex-wrap items-center justify-center gap-2.5">
      {action.href ? (
        <Button asChild size="sm">
          <a href={action.href}>{action.label}</a>
        </Button>
      ) : (
        <Button size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
      {secondaryAction ? (
        secondaryAction.href ? (
          <Button asChild variant="ghost" size="sm">
            <a href={secondaryAction.href}>{secondaryAction.label}</a>
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={secondaryAction.onClick}>
            {secondaryAction.label}
          </Button>
        )
      ) : null}
    </div>
  </div>
)
