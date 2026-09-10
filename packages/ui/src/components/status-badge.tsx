import type { StatusTone } from '@mailysend/design-tokens'
import { statusTone } from '@mailysend/design-tokens'
import type { HTMLAttributes } from 'react'
import { cn } from '../lib/cn.ts'
import { StatusDot } from './status-dot.tsx'

/**
 * Every state a message, domain, key, broadcast or automation can be in. The
 * artboards only ever draw five of them; the rest are invented here so that a
 * status introduced by the API can never reach the UI without a colour.
 */
export type Status =
  | 'queued'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'complained'
  | 'suppressed'
  | 'failed'
  | 'canceled'
  | 'draft'
  | 'paused'
  | 'active'
  | 'archived'
  | 'verified'
  | 'pending'
  | 'not_started'
  /** The check did not happen — distinct from failing it. */
  | 'error'
  | 'temporary_failure'
  | 'revoked'
  | 'expired'
  | 'enabled'
  | 'disabled'

/**
 * The tone is the whole point: `bounced` and `failed` are different words for
 * the reader and the same colour for the eye, so a log scanned at speed sorts
 * into good / working / attention / broken without being read.
 */
export const statusToTone: Record<Status, StatusTone> = {
  queued: 'neutral',
  scheduled: 'neutral',
  sending: 'progress',
  sent: 'progress',
  delivered: 'positive',
  opened: 'progress',
  clicked: 'progress',
  bounced: 'danger',
  complained: 'danger',
  suppressed: 'warning',
  failed: 'danger',
  canceled: 'neutral',
  draft: 'neutral',
  paused: 'warning',
  active: 'positive',
  archived: 'neutral',
  verified: 'positive',
  pending: 'warning',
  not_started: 'neutral',
  // Warning, not danger: nothing is known to be wrong, only unknown.
  error: 'warning',
  temporary_failure: 'warning',
  revoked: 'danger',
  expired: 'warning',
  enabled: 'positive',
  disabled: 'neutral',
}

const dotTone = {
  neutral: 'muted',
  progress: 'accent',
  positive: 'positive',
  warning: 'amber',
  danger: 'warning',
} as const

export interface StatusBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  status: Status
  /** Overrides the humanised status word. */
  label?: string
  size?: 'sm' | 'md'
  /** Hides the leading dot. The dot is the only colour cue at small sizes. */
  hideDot?: boolean
  /** `sending` is the one status that is genuinely live; pass through to the dot. */
  pulse?: boolean
}

export const humanizeStatus = (status: Status): string => status.replace(/_/g, ' ')

export const StatusBadge = ({
  status,
  label,
  size = 'md',
  hideDot = false,
  pulse,
  className,
  ...props
}: StatusBadgeProps) => {
  const tone = statusToTone[status]
  const palette = statusTone[tone]

  return (
    <span
      data-status={status}
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border font-mono',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[11.5px]',
        className,
      )}
      // `statusTone` has no Tailwind utilities behind it: the warning and danger
      // washes exist only in the token module. Reading them here keeps the
      // token file as the single source rather than duplicating five hexes.
      style={{ color: palette.fg, backgroundColor: palette.bg, borderColor: palette.border }}
      {...props}
    >
      {hideDot ? null : (
        <StatusDot tone={dotTone[tone]} size={6} pulse={pulse ?? status === 'sending'} />
      )}
      {label ?? humanizeStatus(status)}
    </span>
  )
}
