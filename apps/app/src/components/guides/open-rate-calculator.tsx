import { privacyAdjustedOpenRate } from '@mailysend/events/bots'
import { Input } from '@mailysend/ui'
import { useId, useState } from 'react'
import { WidgetField, WidgetResult, WidgetShell } from './widget-shell.tsx'

/**
 * What MPP does to an open rate, using the product's own arithmetic.
 *
 * The interesting part is what the naive number does next to the honest one:
 * counting MPP opens inflates the rate and counting them as non-opens deflates
 * it, and both are shown so the gap is visible rather than asserted.
 */
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

export const OpenRateCalculator = () => {
  const id = useId()
  const [delivered, setDelivered] = useState(50_000)
  const [humanOpens, setHumanOpens] = useState(9_000)
  const [mppOpens, setMppOpens] = useState(16_000)

  const adjusted = privacyAdjustedOpenRate({ delivered, humanOpens, mppOpens })
  const naiveHigh = delivered > 0 ? (humanOpens + mppOpens) / delivered : 0
  const naiveLow = delivered > 0 ? humanOpens / delivered : 0

  const number = (value: number, set: (n: number) => void, label: string, key: string) => (
    <WidgetField label={label} htmlFor={`${id}-${key}`}>
      <Input
        id={`${id}-${key}`}
        type="number"
        min={0}
        value={value}
        onChange={(event) => set(Math.max(0, Number(event.target.value) || 0))}
        className="font-mono text-[13px]"
      />
    </WidgetField>
  )

  return (
    <WidgetShell
      title="PRIVACY-ADJUSTED OPEN RATE"
      source={
        <>
          Runs <code className="font-mono">privacyAdjustedOpenRate</code> from{' '}
          <code className="font-mono">@mailysend/events</code>, the function behind the number in
          your dashboard.
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {number(delivered, setDelivered, 'Delivered', 'delivered')}
          {number(humanOpens, setHumanOpens, 'Human opens', 'human')}
          {number(mppOpens, setMppOpens, 'MPP opens', 'mpp')}
        </div>

        <WidgetResult tone="positive">
          <div className="text-[15px] font-semibold text-ink">
            Privacy-adjusted open rate: {adjusted.rate === null ? '—' : pct(adjusted.rate)}
          </div>
          <div className="mt-1 text-[13.5px] text-muted">{adjusted.note}</div>
        </WidgetResult>

        <div className="grid gap-3 sm:grid-cols-2">
          <WidgetResult tone="warning">
            <div className="ms-eyebrow mb-1 text-[10.5px]">IF YOU COUNT MPP AS OPENS</div>
            <div className="text-[15px] font-semibold text-ink">{pct(naiveHigh)}</div>
            <div className="mt-1 text-[13px] text-muted-2">
              Inflated: it counts Apple's cache as readers.
            </div>
          </WidgetResult>
          <WidgetResult>
            <div className="ms-eyebrow mb-1 text-[10.5px]">IF YOU COUNT THEM AS NON-OPENS</div>
            <div className="text-[15px] font-semibold text-ink">{pct(naiveLow)}</div>
            <div className="mt-1 text-[13px] text-muted-2">
              Deflated: those recipients may well have read it.
            </div>
          </WidgetResult>
        </div>
      </div>
    </WidgetShell>
  )
}
