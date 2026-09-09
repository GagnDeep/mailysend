import { Button, Callout, cn, MonoChip, RadioGroup, RadioGroupItem } from '@mailysend/ui'
import { useId } from 'react'
import { num } from '~/components/app/format.ts'

export type AutomationMode = 'cohort' | 'instance'

/**
 * Workflows V2 allows 50,000 concurrent instances per account. Instance mode
 * spends one of those per enrolled contact, so the product ceiling is set below
 * the platform's to leave room for retries and for every other automation in
 * the workspace.
 */
export const INSTANCE_CEILING = 40_000
const WARN_FROM = 32_000

const COHORT_COSTS = [
  'Waits are quantised to an hourly clock: “wait 2 days” means “the next hourly tick after 2 days”.',
  'A wait_until event step cannot run — a cohort has no per-contact inbox to watch.',
]

const INSTANCE_COSTS = [
  `Hard ceiling of ${num(INSTANCE_CEILING)} active enrollments.`,
  'Past the ceiling, new contacts are refused enrollment until instances drain.',
]

interface ModeOption {
  value: AutomationMode
  title: string
  scale: string
  gains: string[]
  costs: string[]
}

const OPTIONS: ModeOption[] = [
  {
    value: 'cohort',
    title: 'Cohort',
    scale: 'One Workflow instance per (version, hourly cohort of up to 25,000 contacts).',
    gains: ['Scales to any audience size.', 'Cost per contact stays flat as the list grows.'],
    costs: COHORT_COSTS,
  },
  {
    value: 'instance',
    title: 'Per contact',
    scale: 'One Workflow instance per contact.',
    gains: [
      'Exact per-contact timing — a 2 day wait ends 2 days later, to the second.',
      'wait_until event works.',
    ],
    costs: INSTANCE_COSTS,
  },
]

export interface AutomationModePickerProps {
  value: AutomationMode
  onChange: (mode: AutomationMode) => void
  /** Live enrollments. Drives the ceiling warning, which is the point of it. */
  enrolledCount?: number
  /** Set when the step list contains a `wait_until`, which cohort mode cannot run. */
  hasWaitUntil?: boolean
}

export const AutomationModePicker = ({
  value,
  onChange,
  enrolledCount,
  hasWaitUntil = false,
}: AutomationModePickerProps) => {
  const groupId = useId()
  const enrolled = enrolledCount ?? 0
  const nearCeiling = value === 'instance' && enrolled >= WARN_FROM

  return (
    <div className="flex flex-col gap-3">
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as AutomationMode)}
        aria-label="Execution mode"
        className="gap-3 md:grid-cols-2"
      >
        {OPTIONS.map((option) => {
          const id = `${groupId}-${option.value}`
          const selected = value === option.value
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cn(
                'flex cursor-pointer flex-col gap-2.5 rounded-tile border p-4 transition-colors duration-[0.18s]',
                selected
                  ? 'border-accent-border bg-accent-soft'
                  : 'border-line-soft bg-card hover:border-muted-3',
              )}
            >
              <span className="flex items-center gap-2.5">
                <RadioGroupItem id={id} value={option.value} />
                <span className="text-[15px] font-semibold">{option.title}</span>
                <MonoChip size="sm" tone={selected ? 'accent' : 'neutral'}>
                  {option.value}
                </MonoChip>
                {option.value === 'cohort' ? (
                  <span className="ms-eyebrow text-[10px] text-muted-2">default</span>
                ) : null}
              </span>

              <span className="text-[13.5px] leading-[1.6] text-muted">{option.scale}</span>

              <span className="flex flex-col gap-1.5">
                <span className="ms-eyebrow text-[10px] text-positive">what you get</span>
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] leading-[1.55] text-muted">
                  {option.gains.map((gain) => (
                    <li key={gain}>{gain}</li>
                  ))}
                </ul>
              </span>

              <span className="flex flex-col gap-1.5">
                <span className="ms-eyebrow text-[10px] text-warning">what it costs</span>
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] leading-[1.55] text-muted">
                  {option.costs.map((cost) => (
                    <li key={cost}>{cost}</li>
                  ))}
                </ul>
              </span>
            </label>
          )
        })}
      </RadioGroup>

      {nearCeiling ? (
        <Callout
          variant="warn"
          title="approaching the instance ceiling"
          actions={
            <Button size="sm" variant="outline" onClick={() => onChange('cohort')}>
              Switch to cohort mode
            </Button>
          }
        >
          {num(enrolled)} contacts are enrolled. Per-contact mode stops accepting enrollments at{' '}
          {num(INSTANCE_CEILING)}, because Cloudflare Workflows V2 allows 50,000 concurrent
          instances and the remainder is headroom for retries and for the workspace's other
          automations. Cohort mode has no such limit; the trade is hourly wait granularity.
        </Callout>
      ) : null}

      {hasWaitUntil && value === 'cohort' ? (
        <Callout
          variant="warn"
          title="wait_until cannot run in cohort mode"
          actions={
            <Button size="sm" variant="outline" onClick={() => onChange('instance')}>
              Switch to per-contact mode
            </Button>
          }
        >
          This automation has a <MonoChip size="sm">wait_until</MonoChip> step. A cohort is one
          Workflow instance shared by up to 25,000 contacts, so it cannot pause for one contact's
          event. Either move to per-contact mode (ceiling {num(INSTANCE_CEILING)} enrollments) or
          replace the step with a fixed <MonoChip size="sm">wait</MonoChip>.
        </Callout>
      ) : null}
    </div>
  )
}
