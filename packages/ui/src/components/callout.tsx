import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { cn } from '../lib/cn.ts'

export type CalloutVariant = 'info' | 'warn' | 'success'

export interface CalloutProps {
  variant?: CalloutVariant
  /** Rendered as the mono kicker above the body. */
  title?: ReactNode
  children: ReactNode
  /** Buttons or links under the body. */
  actions?: ReactNode
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }> | false
  className?: string
}

const styles: Record<
  CalloutVariant,
  { box: string; title: string; icon: ComponentType<{ className?: string }> }
> = {
  info: { box: 'border-line bg-tint', title: 'text-muted', icon: Info },
  warn: { box: 'border-accent-border bg-accent-soft', title: 'text-warning', icon: AlertTriangle },
  success: { box: 'border-positive/25 bg-positive-bg', title: 'text-positive', icon: CheckCircle2 },
}

/**
 * `warn` is `role="alert"` and the other two are not: a warning appearing next
 * to a form field is news, while an info box that interrupts whatever the
 * screen reader was saying is an ambush.
 */
export const Callout = ({
  variant = 'info',
  title,
  children,
  actions,
  icon,
  className,
}: CalloutProps) => {
  const style = styles[variant]
  const Icon = icon === false ? null : (icon ?? style.icon)

  return (
    <div
      role={variant === 'warn' ? 'alert' : undefined}
      className={cn('flex gap-3 rounded-code border p-3.5', style.box, className)}
    >
      {Icon ? (
        <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', style.title)} />
      ) : null}
      <div className="min-w-0 flex-1">
        {title ? (
          <div
            className={cn('mb-1.5 font-mono text-[11px] uppercase tracking-[0.1em]', style.title)}
          >
            {title}
          </div>
        ) : null}
        <div className="text-[14px] leading-[1.65] text-muted">{children}</div>
        {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}
