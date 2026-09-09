import { CalendarDays } from 'lucide-react'
import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { cn } from '../lib/cn.ts'
import { Button } from './button.tsx'
import { Calendar } from './calendar.tsx'
import { Popover, PopoverContent, PopoverTrigger } from './popover.tsx'

export type { DateRange }

export interface DateRangePickerProps {
  value?: DateRange
  defaultValue?: DateRange
  onValueChange?: (range: DateRange | undefined) => void
  /** Rendered when nothing is picked yet. */
  placeholder?: string
  className?: string
  numberOfMonths?: number
}

const format = (date: Date): string =>
  date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })

const label = (range: DateRange | undefined, placeholder: string): string => {
  if (!range?.from) return placeholder
  return range.to ? `${format(range.from)} — ${format(range.to)}` : format(range.from)
}

export const DateRangePicker = ({
  value,
  defaultValue,
  onValueChange,
  placeholder = 'Pick a date range',
  className,
  numberOfMonths = 2,
}: DateRangePickerProps) => {
  const [uncontrolled, setUncontrolled] = useState<DateRange | undefined>(defaultValue)
  const range = value ?? uncontrolled

  const handleSelect = (next: DateRange | undefined) => {
    if (value === undefined) setUncontrolled(next)
    onValueChange?.(next)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn('justify-start gap-2.5 font-mono text-[13px] font-normal', className)}
        >
          <CalendarDays aria-hidden="true" />
          <span className={cn(!range?.from && 'text-muted-2')}>{label(range, placeholder)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="range"
          numberOfMonths={numberOfMonths}
          selected={range}
          onSelect={handleSelect}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}
