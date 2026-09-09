import {
  BarRow,
  cn,
  KeyValue,
  KeyValueList,
  MonoChip,
  Pill,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@mailysend/ui'
import { Info } from 'lucide-react'
import type { PlacementFigureRecord } from '~/lib/api-client.ts'
import { num, pct, shortDate } from './format.ts'

/**
 * The two numbers this product refuses to render bare.
 *
 * A percentage with no provenance is the shape of a measurement and the
 * content of a guess, and both of these numbers are routinely guesses: SMTP
 * `250` means the receiving MTA accepted the bytes, not that a human will see
 * them, and Apple's Mail Privacy Protection opens every pixel whether or not
 * anyone read the mail.
 */

const SOURCE_COPY: Record<string, { label: string; detail: string; measured: boolean }> = {
  seed: {
    label: 'seed list',
    detail: 'Measured by delivering to mailboxes we control and reading where each one landed.',
    measured: true,
  },
  postmaster: {
    label: 'postmaster tools',
    detail: 'Reported by the receiving provider for your domain, aggregated over their window.',
    measured: true,
  },
  snds: {
    label: 'microsoft snds',
    detail: 'Reported by Microsoft Smart Network Data Services for your sending IPs.',
    measured: true,
  },
  estimate: {
    label: 'estimate',
    detail:
      'Not measured. Inferred from delivery and engagement events, which cannot distinguish an inboxed message from one filed as spam.',
    measured: false,
  },
}

const CONFIDENCE_TONE = {
  high: 'positive',
  medium: 'outline',
  low: 'accent',
} as const

export const MetricSourceTag = ({
  source,
  confidence,
  sampleSize,
  measuredAt,
}: {
  source: string
  confidence?: 'high' | 'medium' | 'low'
  sampleSize?: number | null
  measuredAt?: string
}) => {
  const copy = SOURCE_COPY[source] ?? {
    label: source,
    detail: 'Unrecognised source. Treat this figure as unverified.',
    measured: false,
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5">
          <MonoChip size="sm" tone={copy.measured ? 'neutral' : 'warning'}>
            {copy.measured ? copy.label : 'estimate · not measured'}
          </MonoChip>
          {confidence ? (
            <Pill size="sm" tone={CONFIDENCE_TONE[confidence]}>
              {confidence} confidence
            </Pill>
          ) : null}
          <Info aria-hidden="true" className="size-3 text-muted-2" />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {copy.detail}
        {sampleSize ? ` Sample: ${num(sampleSize)} messages.` : ' No sample size reported.'}
        {measuredAt ? ` Measured ${shortDate(measuredAt)}.` : ''}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * One provider's placement. The three shares are drawn together because
 * "94% inbox" alone hides whether the remaining 6% was spam-foldered or never
 * arrived, and those are different problems with different fixes.
 */
export const PlacementCard = ({
  figure,
  className,
}: {
  figure: PlacementFigureRecord
  className?: string
}) => (
  <div className={cn('rounded-tile border border-line-soft bg-card p-4', className)}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-[15px] font-semibold">{figure.provider}</span>
      <MetricSourceTag
        source={figure.source}
        confidence={figure.confidence}
        sampleSize={figure.sample_size}
        measuredAt={figure.measured_at}
      />
    </div>
    <div className="mt-3 flex flex-col gap-2">
      <BarRow
        label="Inbox"
        percent={figure.inbox_percent}
        value={pct(figure.inbox_percent)}
        series="positive"
      />
      <BarRow
        label="Spam"
        percent={figure.spam_percent}
        value={pct(figure.spam_percent)}
        series="amber"
        valueIntent={figure.spam_percent > 5 ? 'negative' : 'default'}
      />
      <BarRow
        label="Missing"
        percent={figure.missing_percent}
        value={pct(figure.missing_percent)}
        series="neutral"
      />
    </div>
    {figure.source === 'estimate' ? (
      <p className="m-0 mt-3 text-[13px] leading-snug text-warning">
        Estimated from delivery events. Run a seed-list test for a measured figure.
      </p>
    ) : null}
  </div>
)

/**
 * The open rate, with MPP taken out of both the numerator and the denominator.
 *
 * Dividing human opens by all delivered would understate engagement as badly as
 * counting MPP prefetches overstates it, so the ratio is recomputed on the
 * subset rather than adjusted after the fact.
 */
export const PrivacyAdjustedOpenRate = ({
  humanOpens,
  humanDelivered,
  rawOpens,
  delivered,
}: {
  humanOpens: number
  humanDelivered: number
  rawOpens: number
  delivered: number
}) => {
  const adjusted = humanDelivered === 0 ? null : (humanOpens / humanDelivered) * 100
  const raw = delivered === 0 ? null : (rawOpens / delivered) * 100

  return (
    <div className="rounded-tile border border-line-soft bg-card p-4">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="ms-eyebrow inline-flex items-center gap-1.5 text-[10.5px] text-muted-2">
            privacy-adjusted open rate
            <Info aria-hidden="true" className="size-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Apple Mail Privacy Protection fetches the tracking pixel whether or not anyone opened the
          message. This figure excludes MPP recipients from both the opens and the delivered count,
          so it is a rate over the population it can actually measure.
        </TooltipContent>
      </Tooltip>
      <div className="ms-num mt-1.5 font-display text-[30px] font-medium -tracking-[0.03em]">
        {adjusted === null ? '—' : pct(adjusted)}
      </div>
      <KeyValueList className="mt-3">
        <KeyValue label="Human opens" value={num(humanOpens)} mono />
        <KeyValue label="Human delivered" value={num(humanDelivered)} mono />
        <KeyValue
          label="Unadjusted rate"
          value={raw === null ? '—' : pct(raw)}
          mono
          intent="muted"
        />
      </KeyValueList>
    </div>
  )
}
