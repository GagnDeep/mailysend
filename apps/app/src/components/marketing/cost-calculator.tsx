import { cn, Eyebrow, Label, Slider, StatTile } from '@mailysend/ui'
import { type ReactNode, useId, useState } from 'react'

/**
 * The cost model behind both `/stack` and `/pricing`.
 *
 * The two artboards each carried their own copy of these formulas, and they had
 * already drifted: `Stack.dc.html` quoted raw SES at `$0.10/1k` with no floor,
 * `Pricing.dc.html` quoted the same volume through a MailySend deployment that
 * still pays Cloudflare's $5. Both are true of different things, so both survive
 * here as named functions rather than one silently winning.
 */

/** Cloudflare Email Sending includes 3,000 messages a month before metering. */
const INCLUDED = 3000
const WORKERS_PAID = 5

/** Billable thousands after the included allowance. */
const billableThousands = (volume: number) => Math.max(0, volume - INCLUDED) / 1000

/**
 * Storage, queues and analytics. Cents below 20k, then the worked examples on
 * `/stack` — ≈$1.20 at 100k, ≈$9 at a million — which is what these steps are.
 */
const extras = (volume: number) => (volume > 100_000 ? 9 : volume > 20_000 ? 1.2 : 0)

/** MailySend in your own account: Workers Paid, metered sends, storage. */
export const selfHostedCost = (volume: number) =>
  WORKERS_PAID + billableThousands(volume) * 0.35 + extras(volume)

/** The same deployment with a domain pointed at Amazon SES instead. */
export const sesProviderCost = (volume: number) =>
  WORKERS_PAID + (volume / 1000) * 0.1 + extras(volume)

/** SES alone — the number people quote when comparing raw send rates. */
export const sesRawCost = (volume: number) => Math.max(0.1, (volume / 1000) * 0.1)

/** Resend's published plan ladder: Free, Pro, Pro 100k, then "contact us". */
export const resendCost = (volume: number) => {
  if (volume <= 3000) return 0
  if (volume <= 50_000) return 20
  if (volume <= 100_000) return 90
  return (volume / 1000) * 0.65
}

/** SendGrid Essentials/Pro, flattened to their per-thousand rate over a floor. */
export const sendgridCost = (volume: number) => Math.max(19.95, (volume / 1000) * 0.6)

/** Cents matter at $7.45; they are noise at $363, and free is just free. */
export const money = (n: number) => {
  if (n === 0) return '$0'
  return n >= 1000
    ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : `$${n.toFixed(2)}`
}

export interface CostTile {
  label: string
  /** Given the slider volume in emails/month, the dollar figure to show. */
  cost: (volume: number) => number
  /** The rate this tile is derived from, printed under the number. */
  basis: ReactNode
  /** The one tile the page is arguing for. */
  highlight?: boolean
}

export interface CostCalculatorProps {
  eyebrow: string
  title: string
  lede: ReactNode
  tiles: CostTile[]
  /** Footnote under the tiles — both pages qualify the numbers differently. */
  note: ReactNode
  className?: string
}

const DEFAULT_VOLUME = 100_000

/**
 * The volume calculator, shared by `/stack#calculator` and `/pricing#calculator`.
 *
 * The artboards used a bare `<input type="range">` with no label and no readout
 * association, so a screen reader announced "1000 to 1000000" and nothing about
 * what was being dragged or what it cost. This is the `Slider` primitive with a
 * real `<Label>`, an `aria-valuetext` in emails per month, and a live region on
 * the tiles so the prices are announced as they change rather than silently
 * rewritten behind the thumb.
 */
export const CostCalculator = ({
  eyebrow,
  title,
  lede,
  tiles,
  note,
  className,
}: CostCalculatorProps) => {
  const [volume, setVolume] = useState(DEFAULT_VOLUME)
  const sliderId = useId()
  const readout = volume.toLocaleString('en-US')

  return (
    <div className={cn('rounded-block bg-ink px-6 py-8 text-paper sm:px-10 sm:py-11', className)}>
      <Eyebrow className="text-accent-on-dark">{eyebrow}</Eyebrow>
      <h2 className="ms-display-2 mt-3.5 mb-2">{title}</h2>
      <p className="max-w-[58ch] text-[16px] text-on-dark-3">{lede}</p>

      <div className="mt-7 mb-7 flex flex-wrap items-center gap-[18px]">
        <div className="min-w-[200px] flex-[1_1_260px]">
          <Label htmlFor={sliderId} className="sr-only">
            Monthly email volume
          </Label>
          <Slider
            id={sliderId}
            min={1000}
            max={1_000_000}
            step={1000}
            value={[volume]}
            onValueChange={([next]) => setVolume(next ?? DEFAULT_VOLUME)}
            aria-label="Monthly email volume"
            aria-valuetext={`${readout} emails per month`}
          />
        </div>
        <p className="ms-num min-w-[180px] font-display text-[34px] font-medium -tracking-[0.03em]">
          {readout}
          <span className="font-body text-[15px] text-on-dark-3"> emails/mo</span>
        </p>
      </div>

      <div
        aria-live="polite"
        className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(168px,1fr))]"
      >
        {tiles.map((tile) => (
          <StatTile
            key={tile.label}
            tone={tile.highlight ? 'dark-accent' : 'dark'}
            label={tile.label}
            value={money(tile.cost(volume))}
            delta={tile.basis}
            className="p-5"
          />
        ))}
      </div>

      <p className="mt-5 text-[13.5px] leading-relaxed text-on-dark-4">{note}</p>
    </div>
  )
}
