import type { ReactNode } from 'react'
import { useId, useState } from 'react'
import { cn } from '../lib/cn.ts'
import type { Status } from './status-badge.tsx'
import { StatusBadge, statusToTone } from './status-badge.tsx'
import { StatusDot } from './status-dot.tsx'

const dotTone = {
  neutral: 'muted',
  progress: 'accent',
  positive: 'positive',
  warning: 'amber',
  danger: 'warning',
} as const

export interface LogRowProps {
  status: Status
  /** Already formatted — the row never guesses the reader's timezone. */
  timestamp: string
  recipient: string
  subject: string
  /** Renders the expandable panel and, by its presence, the disclosure button. */
  details?: ReactNode
  defaultExpanded?: boolean
  /** Highlights the row the log is currently focused on. */
  selected?: boolean
  /** Shows the full badge instead of the bare mono status word. */
  showBadge?: boolean
  onSelect?: () => void
  className?: string
}

export const LogRow = ({
  status,
  timestamp,
  recipient,
  subject,
  details,
  defaultExpanded = false,
  selected = false,
  showBadge = false,
  onSelect,
  className,
}: LogRowProps) => {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const panelId = useId()
  const tone = statusToTone[status]

  const summary = (
    <>
      <StatusDot tone={dotTone[tone]} size={8} pulse={status === 'sending'} />
      <span className="min-w-0 flex-1 truncate text-left text-[13.5px]">
        {subject} <span className="text-muted-2">— {recipient}</span>
      </span>
      {showBadge ? (
        <StatusBadge status={status} size="sm" hideDot />
      ) : (
        <span className="shrink-0 font-mono text-[11.5px] text-muted">
          {status.replace(/_/g, ' ')}
        </span>
      )}
      <time className="ms-num shrink-0 font-mono text-[11.5px] text-muted-2">{timestamp}</time>
    </>
  )

  return (
    <div
      className={cn(
        'border-b border-line-soft last:border-b-0',
        selected && 'bg-accent-soft',
        className,
      )}
    >
      {details ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => {
            setExpanded((v) => !v)
            onSelect?.()
          }}
          className="flex w-full flex-wrap items-center gap-3 px-4 py-3.5 transition-colors duration-[0.18s] hover:bg-tint"
        >
          {summary}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">{summary}</div>
      )}
      {details ? (
        <div id={panelId} hidden={!expanded} className="border-t border-line-soft bg-card p-4">
          {details}
        </div>
      ) : null}
    </div>
  )
}
