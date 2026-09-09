import {
  Button,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@mailysend/ui'
import { Plus, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

/**
 * The filter strip from the artboard: applied filters as dark mono chips,
 * available ones behind a `+ filter` popover.
 *
 * Each chip is a button that removes its own filter, and the removal is
 * announced through the button's label rather than implied by an `×` glyph.
 */

export interface FilterDefinition {
  id: string
  label: string
  options: { value: string; label: string }[]
}

export interface AppliedFilter {
  id: string
  value: string
}

export const FilterChip = ({
  label,
  value,
  onRemove,
  tone = 'active',
}: {
  label: string
  value: ReactNode
  onRemove?: () => void
  tone?: 'active' | 'quiet'
}) => (
  <span
    className={cn(
      'inline-flex items-center gap-2 rounded-sm px-3 py-[7px] font-mono text-[12px]',
      tone === 'active' ? 'bg-ink text-paper' : 'bg-tint text-muted',
    )}
  >
    <span>
      {label}: {value}
    </span>
    {onRemove ? (
      <button
        type="button"
        aria-label={`Remove filter ${label}`}
        onClick={onRemove}
        className={cn(
          'grid size-4 place-items-center rounded-pill transition-opacity duration-[0.18s]',
          tone === 'active' ? 'text-on-dark-3 hover:text-paper' : 'text-muted-2 hover:text-ink',
        )}
      >
        <X aria-hidden="true" className="size-3" />
      </button>
    ) : null}
  </span>
)

export const FilterBar = ({
  definitions,
  applied,
  onChange,
  extra,
}: {
  definitions: FilterDefinition[]
  applied: AppliedFilter[]
  onChange: (next: AppliedFilter[]) => void
  /** A date-range picker or a search box, rendered after the chips. */
  extra?: ReactNode
}) => {
  const [open, setOpen] = useState(false)
  const [pendingId, setPendingId] = useState<string>('')

  const unapplied = definitions.filter(
    (definition) => !applied.some((filter) => filter.id === definition.id),
  )
  const pending = definitions.find((definition) => definition.id === pendingId)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {applied.map((filter) => {
        const definition = definitions.find((candidate) => candidate.id === filter.id)
        const option = definition?.options.find((candidate) => candidate.value === filter.value)
        return (
          <FilterChip
            key={filter.id}
            label={definition?.label ?? filter.id}
            value={option?.label ?? filter.value}
            onRemove={() => onChange(applied.filter((candidate) => candidate.id !== filter.id))}
          />
        )
      })}

      {unapplied.length > 0 ? (
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (!next) setPendingId('')
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 bg-tint font-mono text-[12px]">
              <Plus aria-hidden="true" />
              filter
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-64 flex-col gap-2.5">
            <Select value={pendingId} onValueChange={setPendingId}>
              <SelectTrigger aria-label="Filter field">
                <SelectValue placeholder="Field" />
              </SelectTrigger>
              <SelectContent>
                {unapplied.map((definition) => (
                  <SelectItem key={definition.id} value={definition.id}>
                    {definition.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {pending ? (
              <Select
                value=""
                onValueChange={(value) => {
                  onChange([...applied, { id: pending.id, value }])
                  setPendingId('')
                  setOpen(false)
                }}
              >
                <SelectTrigger aria-label={`${pending.label} value`}>
                  <SelectValue placeholder="Value" />
                </SelectTrigger>
                <SelectContent>
                  {pending.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </PopoverContent>
        </Popover>
      ) : null}

      {extra}
    </div>
  )
}
