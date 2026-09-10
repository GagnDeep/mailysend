import { WidgetResult, WidgetShell } from './widget-shell.tsx'

/**
 * The webhook retry ladder, drawn.
 *
 * "We retry with backoff" is a sentence that tells a reader nothing about
 * whether their endpoint being down for an afternoon loses events. The shape
 * answers that in one glance, so this is a static rendering rather than an
 * interactive control: there is nothing to configure, only something to see.
 */
const QUEUE_ATTEMPTS = 6
const TAIL_HOURS = [3, 6, 12, 24]

export const RetryBackoffVisualizer = () => {
  const total = TAIL_HOURS.reduce((sum, hours) => sum + hours, 0)

  return (
    <WidgetShell
      title="RETRY LADDER"
      source="The queue's own attempt count, then the actor tail. Both are the values the delivery path uses."
    >
      <div className="flex flex-col gap-4">
        <div>
          <div className="ms-eyebrow mb-2 text-[10.5px]">IMMEDIATE — THE QUEUE</div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: QUEUE_ATTEMPTS }, (_, index) => `try ${index + 1}`).map(
              (attempt) => (
                <span
                  key={attempt}
                  className="rounded-chip bg-tint px-2.5 py-1 font-mono text-[11.5px] text-muted"
                >
                  {attempt}
                </span>
              ),
            )}
          </div>
          <p className="mt-2 mb-0 text-[13px] text-muted-2">
            Six attempts with the queue's own backoff, over minutes. This absorbs a deploy, a
            restart, or a momentary 502.
          </p>
        </div>

        <div>
          <div className="ms-eyebrow mb-2 text-[10.5px]">THEN — THE LONG TAIL</div>
          <div className="flex flex-wrap items-end gap-2">
            {TAIL_HOURS.map((hours) => (
              <div key={hours} className="flex flex-col items-center gap-1">
                <div
                  className="w-14 rounded-tile bg-accent-soft"
                  style={{ height: `${20 + hours * 3}px` }}
                  aria-hidden="true"
                />
                <span className="font-mono text-[11.5px] text-muted">+{hours}h</span>
              </div>
            ))}
          </div>
          <p className="mt-2 mb-0 text-[13px] text-muted-2">
            Four more attempts spread across {total} hours. An endpoint that is down for a working
            day still receives the event.
          </p>
        </div>

        <WidgetResult tone="warning">
          After twenty consecutive failures the endpoint is disabled and stops receiving deliveries.
          Fix the receiver, re-enable it, then replay the window you missed — the events are still
          there.
        </WidgetResult>
      </div>
    </WidgetShell>
  )
}
