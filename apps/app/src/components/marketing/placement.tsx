import { BarRow, cn, MonoChip, Tooltip, TooltipContent, TooltipTrigger } from '@mailysend/ui'
import { PLACEMENT_SOURCE_LABEL, PLACEMENT_SOURCE_NOTE, type PlacementSource } from './claims.ts'

export type Confidence = 'high' | 'medium' | 'low'

const confidenceTone: Record<Confidence, string> = {
  high: 'text-positive',
  medium: 'text-muted',
  low: 'text-warning',
}

export interface SourceTagProps {
  source: PlacementSource
  confidence: Confidence
  className?: string
}

/**
 * The provenance stamp that has to sit next to every inbox-placement figure.
 *
 * A `250` from a receiving MTA means the message was accepted, not that it
 * reached an inbox, so a placement percentage derived from delivery events is
 * a guess wearing a measurement's clothes. Naming the source is what makes the
 * difference legible at a glance.
 */
export const SourceTag = ({ source, confidence, className }: SourceTagProps) => (
  <Tooltip>
    <TooltipTrigger className={cn('cursor-help', className)}>
      <MonoChip
        tone={source === 'estimate' ? 'warning' : 'neutral'}
        size="sm"
        className="tracking-[0.08em]"
      >
        {source}
        <span className={cn('font-normal', confidenceTone[confidence])}>· {confidence}</span>
      </MonoChip>
    </TooltipTrigger>
    <TooltipContent className="max-w-[34ch]">
      <span className="font-semibold">{PLACEMENT_SOURCE_LABEL[source]}.</span>{' '}
      {PLACEMENT_SOURCE_NOTE[source]}
    </TooltipContent>
  </Tooltip>
)

export interface PlacementRowProps {
  provider: string
  percent: number
  source: PlacementSource
  confidence: Confidence
}

/** One provider's placement, with where the number came from attached to it. */
export const PlacementRow = ({ provider, percent, source, confidence }: PlacementRowProps) => (
  <div className="flex items-center gap-3">
    <BarRow
      className="flex-1"
      label={provider}
      percent={percent}
      value={`${percent.toFixed(1)}%`}
      series={percent >= 96 ? 'positive-bright' : percent >= 92 ? 'accent' : 'neutral'}
      labelWidth={88}
    />
    <SourceTag source={source} confidence={confidence} />
  </div>
)
