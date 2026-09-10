import { useState } from 'react'
import { WidgetShell } from './widget-shell.tsx'

/**
 * An ordered checklist a reader can tick as they go.
 *
 * Shared by four guides, because the same shape solves the same problem in each
 * of them: a long diagnostic list is where people lose their place. Order is
 * the substance — each step is cheaper than the one after it, and doing them
 * out of order is how an afternoon disappears into content tweaks when the
 * actual problem was a second SPF record.
 *
 * The ticks are ephemeral React state and are never written to the URL. A
 * `?done=1,2` would mint crawlable duplicates of the page that no `Disallow`
 * rule covers.
 */
export interface ChecklistStep {
  label: string
  detail: string
}

export const TroubleshootingChecklist = ({
  title,
  steps,
}: {
  title: string
  steps: ChecklistStep[]
}) => {
  const [done, setDone] = useState<string[]>([])

  const toggle = (label: string) =>
    setDone((current) =>
      current.includes(label) ? current.filter((item) => item !== label) : [...current, label],
    )

  return (
    <WidgetShell
      title={title}
      source={`${steps.length} steps, cheapest first. Ticks are local to this browser tab and are not saved.`}
    >
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {steps.map((step, index) => {
          const checked = done.includes(step.label)
          return (
            <li key={step.label}>
              <label
                className={
                  checked
                    ? 'flex cursor-pointer items-start gap-3 rounded-tile border border-positive/25 bg-positive-bg p-3.5'
                    : 'flex cursor-pointer items-start gap-3 rounded-tile border border-line bg-tint p-3.5'
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(step.label)}
                  className="mt-1 size-4 shrink-0 accent-current"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-[11.5px] text-muted-2">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="text-[14.5px] font-semibold text-ink">{step.label}</span>
                  </span>
                  <span className="mt-1 block text-[13.5px] leading-[1.55] text-muted">
                    {step.detail}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ol>
    </WidgetShell>
  )
}
