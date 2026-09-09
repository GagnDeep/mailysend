import {
  Button,
  cn,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@mailysend/ui'
import { FlaskConical, Radio } from 'lucide-react'
import type { Environment } from '~/lib/api-client.ts'
import { useAppScope } from './scope.tsx'

/**
 * Live / test.
 *
 * Nothing else in the product surfaces the split — it exists because keys are
 * minted as `ms_live_…` or `ms_test_…` — so this control is the only place a
 * reader can learn that test data is a separate world. It is a two-option
 * radio group rather than a toggle: "on" and "off" do not say which is which.
 */
export const EnvironmentSwitcher = () => {
  const { environment, setEnvironment } = useAppScope()

  const option = (value: Environment, Icon: typeof Radio, hint: string) => (
    <Tooltip key={value}>
      <TooltipTrigger asChild>
        <ToggleGroupItem
          value={value}
          aria-label={`${value} environment`}
          className={cn(
            'flex items-center gap-1.5 rounded-pill bg-transparent px-2.5 py-1',
            value === 'test' && 'data-[state=on]:bg-accent-soft data-[state=on]:text-warning',
          )}
        >
          <Icon aria-hidden="true" className="size-3" />
          {value}
        </ToggleGroupItem>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )

  return (
    <ToggleGroup
      type="single"
      value={environment}
      // Radix allows deselecting the active item, which would leave the app in
      // no environment at all; an empty value is treated as "no change".
      onValueChange={(next: string) => {
        if (next === 'live' || next === 'test') setEnvironment(next)
      }}
      aria-label="Environment"
      className="gap-0.5 rounded-pill border border-line bg-card p-0.5"
    >
      {option('live', Radio, 'ms_live_ keys. Real recipients, real spend.')}
      {option('test', FlaskConical, 'ms_test_ keys. Nothing leaves the building.')}
    </ToggleGroup>
  )
}

/** The banner the test environment earns; live gets nothing. */
export const EnvironmentBanner = () => {
  const { environment, setEnvironment } = useAppScope()
  if (environment !== 'test') return null

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-accent-border bg-accent-soft px-5 py-2 text-[13px] text-warning"
    >
      <FlaskConical aria-hidden="true" className="size-3.5" />
      <span>
        Test environment. Sends are accepted and logged, but nothing is handed to a provider.
      </span>
      <Button variant="link" size="sm" className="h-auto" onClick={() => setEnvironment('live')}>
        Switch to live
      </Button>
    </div>
  )
}
