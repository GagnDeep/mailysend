import { cn, Eyebrow, HairlineRule } from '@mailysend/ui'
import type { ReactNode } from 'react'

export interface PageHeaderProps {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** Filter chips, tabs or a search field, on the line under the title. */
  toolbar?: ReactNode
  className?: string
}

/**
 * The top of every screen. `h1` lives here and nowhere else, so each route has
 * exactly one and the document outline matches what the reader sees.
 */
export const PageHeader = ({
  eyebrow,
  title,
  description,
  actions,
  toolbar,
  className,
}: PageHeaderProps) => (
  <div className={cn('flex flex-col gap-4', className)}>
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1
          className={cn(
            'font-display text-[26px] font-medium -tracking-[0.03em] leading-tight',
            eyebrow && 'mt-2',
          )}
        >
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-[70ch] text-[14.5px] leading-relaxed text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
    {toolbar}
  </div>
)

export const PageSection = ({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) => (
  <section className={cn('flex flex-col gap-3', className)}>
    {title ? (
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="font-display text-[17px] font-medium -tracking-[0.02em]">{title}</h2>
          {description ? <p className="mt-1 text-[13.5px] text-muted">{description}</p> : null}
        </div>
        {action}
      </div>
    ) : null}
    {children}
  </section>
)

export const PageDivider = () => <HairlineRule soft className="my-2" />
