import { Input } from '@mailysend/ui'
import { useId, useState } from 'react'
import {
  money,
  resendCost,
  selfHostedCost,
  sendgridCost,
  sesProviderCost,
} from '~/components/marketing/cost-calculator.tsx'
import { WidgetField, WidgetResult, WidgetShell } from './widget-shell.tsx'

/**
 * Cost by volume, using the pricing page's own functions.
 *
 * Importing them rather than restating them is the point: a guide that quoted
 * "$X at 100k" would be a second, unversioned copy of the pricing model, and
 * the first time the real one changed the guide would start lying.
 */
const STEPS = [10_000, 100_000, 1_000_000]

export const VolumeCostPanel = () => {
  const id = useId()
  const [volume, setVolume] = useState(100_000)

  const rows: Array<[string, number]> = [
    ['MailySend on your Cloudflare', selfHostedCost(volume)],
    ['Amazon SES as the transport', sesProviderCost(volume)],
    ['Resend', resendCost(volume)],
    ['SendGrid', sendgridCost(volume)],
  ]
  const cheapest = Math.min(...rows.map(([, value]) => value))

  return (
    <WidgetShell
      title="COST BY VOLUME"
      source={
        <>
          Runs the same <code className="font-mono">selfHostedCost</code>,{' '}
          <code className="font-mono">sesProviderCost</code>,{' '}
          <code className="font-mono">resendCost</code> and{' '}
          <code className="font-mono">sendgridCost</code> functions the pricing page uses.
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <WidgetField
          label="Emails per month"
          htmlFor={`${id}-volume`}
          hint="Everything below is monthly, in US dollars, and excludes your own time."
        >
          <Input
            id={`${id}-volume`}
            type="number"
            min={0}
            step={1000}
            value={volume}
            onChange={(event) => setVolume(Math.max(0, Number(event.target.value) || 0))}
            className="font-mono text-[13px]"
          />
        </WidgetField>

        <div className="flex flex-wrap gap-2">
          {STEPS.map((step) => (
            <button
              key={step}
              type="button"
              onClick={() => setVolume(step)}
              className="rounded-chip border border-line bg-tint px-2.5 py-1 font-mono text-[11.5px] text-muted hover:border-ink hover:text-ink"
            >
              {step.toLocaleString()}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          {rows.map(([label, value]) => (
            <WidgetResult key={label} tone={value === cheapest ? 'positive' : 'neutral'}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="font-semibold text-ink">{label}</span>
                <span className="font-mono text-[15px] text-ink">{money(value)}</span>
              </div>
            </WidgetResult>
          ))}
        </div>

        <p className="m-0 text-[13px] leading-[1.55] text-muted-2">
          The self-hosted figure is an infrastructure bill, not a plan price — there is no upgrade
          tier to buy. Below a few thousand messages a month the fixed floor dominates and a
          vendor's free tier is genuinely cheaper; the crossover is the number worth knowing, and it
          is in the curve rather than in anyone's marketing.
        </p>
      </div>
    </WidgetShell>
  )
}
