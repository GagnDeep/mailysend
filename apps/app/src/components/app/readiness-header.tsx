import { StatusBadge } from '@mailysend/ui'
import { Check, CircleDashed, CircleHelp, Dot, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Step, Track } from './readiness.ts'

/**
 * The two questions, answered at the top of the page.
 *
 * Everything that used to be a co-equal `<PageSection>` becomes evidence
 * underneath the claim it supports: DKIM/SPF/DMARC are the evidence for the
 * sending track, mailboxes are the evidence for the receiving one, and the DNS
 * table folds away as "what we will check". A reader who wants only the answer
 * reads two lines; a reader who wants the proof scrolls.
 *
 * The rails deliberately look the same even though the two tracks are not
 * symmetrical — the receiving one has a step marked `unknowable`, and drawing
 * that in the same shape as the rest is what makes the gap legible rather than
 * hidden.
 */

const ACTOR_NOTE: Record<Track['actor'], string | null> = {
  'you-here': 'Here, on this page.',
  cloudflare: "In the transport's own dashboard — it is not something we can do for you.",
  'your-dns': 'At your DNS provider.',
  nobody: null,
}

const StepIcon = ({ state }: { state: Step['state'] }) => {
  const shared = 'size-[15px] shrink-0'
  if (state === 'done') return <Check aria-hidden="true" className={`${shared} text-positive`} />
  if (state === 'blocked') return <X aria-hidden="true" className={`${shared} text-warning`} />
  if (state === 'current')
    return <Dot aria-hidden="true" className={`${shared} text-accent`} strokeWidth={6} />
  // Two different kinds of "not yet": one is waiting on the step above it, the
  // other can never be answered from here and says so with its own mark.
  if (state === 'unknowable')
    return <CircleHelp aria-hidden="true" className={`${shared} text-muted-2`} />
  return <CircleDashed aria-hidden="true" className={`${shared} text-muted-3`} />
}

const STATE_LABEL: Record<Step['state'], string> = {
  done: 'done',
  current: 'next',
  blocked: 'blocked',
  waiting: 'waiting',
  unknowable: 'we cannot check this',
}

function Rail({
  heading,
  track,
  action,
}: {
  heading: string
  track: Track
  /** The control that performs `track.action`, where the page can offer one. */
  action?: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-tile border border-line-soft bg-card p-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-2">
          {heading}
        </span>
        <StatusBadge status={track.badge} size="sm" />
      </div>

      <p className="m-0 max-w-[60ch] text-[15px] font-medium leading-snug text-ink">
        {track.headline}
      </p>

      {track.action ? (
        <div className="flex flex-wrap items-center gap-2.5">
          {action ?? null}
          <span className="text-[13px] text-muted">
            {track.action}
            {ACTOR_NOTE[track.actor] ? (
              <span className="block text-[12.5px] text-muted-2">{ACTOR_NOTE[track.actor]}</span>
            ) : null}
          </span>
        </div>
      ) : (
        <p className="m-0 text-[13px] text-muted">Nothing is outstanding here.</p>
      )}

      <ol className="m-0 flex list-none flex-col gap-2.5 border-t border-line-soft p-0 pt-3">
        {track.steps.map((step) => (
          <li key={step.key} className="flex gap-2.5">
            <span className="pt-[3px]">
              <StepIcon state={step.state} />
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-baseline gap-2">
                <span
                  className={
                    step.state === 'done'
                      ? 'text-[13.5px] text-muted'
                      : 'text-[13.5px] font-medium text-ink'
                  }
                >
                  {step.title}
                </span>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-3">
                  {STATE_LABEL[step.state]}
                </span>
              </span>
              <span className="mt-0.5 block max-w-[70ch] text-[12.5px] leading-[1.6] text-muted-2">
                {step.detail}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function ReadinessHeader({
  sending,
  receiving,
  sendingAction,
  receivingAction,
}: {
  sending: Track
  receiving: Track
  sendingAction?: ReactNode
  receivingAction?: ReactNode
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Rail
        heading="Sending"
        track={sending}
        {...(sendingAction ? { action: sendingAction } : {})}
      />
      <Rail
        heading="Receiving"
        track={receiving}
        {...(receivingAction ? { action: receivingAction } : {})}
      />
    </div>
  )
}
