import { Button } from '@mailysend/ui'
import { ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * The hand-off block: this setup finishes somewhere else.
 *
 * When the transport publishes its own records — every row `observe`, which is
 * every Cloudflare domain — copying is not the job and never was. Leading with
 * a table of values nobody types made a two-click hand-off read like fifteen
 * minutes of DNS work, so the hand-off is the affordance and the records fold
 * away beneath it as "what we will check".
 *
 * The wizard and the detail page had two hand-written copies of this and had
 * already drifted: one said "Email Sending", the other said nothing at all
 * until three failed polls had gone by. One block, used twice.
 */
export function Handoff({
  title,
  body,
  href,
  linkLabel,
  detail,
  children,
}: {
  title: string
  body: ReactNode
  href: string
  linkLabel: string
  /** The transport's own words about the state, where it gave any. */
  detail?: string | null
  /** A secondary control — usually "Check records". */
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 rounded-code border border-line bg-tint p-4">
      <span>
        <span className="block text-[14px] font-semibold text-ink">{title}</span>
        <span className="mt-1 block text-[13.5px] leading-[1.6] text-muted">{body}</span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Button asChild variant="primary">
          <a href={href} target="_blank" rel="noopener noreferrer">
            {linkLabel}
            <ExternalLink aria-hidden="true" className="size-[15px]" />
          </a>
        </Button>
        {children}
      </span>
      {detail ? (
        <span className="block text-[12.5px] leading-[1.6] text-muted-2">{detail}</span>
      ) : null}
    </div>
  )
}
