import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ComponentProps } from 'react'
import { DayPicker } from 'react-day-picker'
import { cn } from '../lib/cn.ts'

export type CalendarProps = ComponentProps<typeof DayPicker>

export const Calendar = ({ className, classNames, ...props }: CalendarProps) => (
  <DayPicker
    className={cn('p-3', className)}
    classNames={{
      months: 'flex flex-col gap-4 sm:flex-row',
      month: 'flex flex-col gap-3',
      month_caption: 'flex h-9 items-center justify-center',
      caption_label: 'font-display text-[15px] font-medium -tracking-[0.02em]',
      nav: 'flex items-center justify-between absolute inset-x-3 top-3',
      button_previous:
        'grid size-8 place-items-center rounded-pill text-muted-2 transition-colors hover:bg-tint hover:text-ink',
      button_next:
        'grid size-8 place-items-center rounded-pill text-muted-2 transition-colors hover:bg-tint hover:text-ink',
      month_grid: 'w-full border-collapse',
      weekdays: 'flex',
      weekday: 'ms-eyebrow w-9 text-center',
      week: 'mt-1 flex w-full',
      day: 'size-9 p-0 text-center',
      day_button:
        'ms-num size-9 rounded-pill text-[13.5px] transition-colors hover:bg-tint disabled:opacity-40',
      selected: '[&_button]:bg-ink [&_button]:text-paper [&_button]:hover:bg-ink',
      today: '[&_button]:text-accent [&_button]:font-semibold',
      outside: 'text-muted-3',
      disabled: 'opacity-40',
      range_start: '[&_button]:bg-ink [&_button]:text-paper rounded-l-pill bg-accent-soft',
      range_middle: 'bg-accent-soft [&_button]:bg-transparent [&_button]:text-ink',
      range_end: '[&_button]:bg-ink [&_button]:text-paper rounded-r-pill bg-accent-soft',
      hidden: 'invisible',
      ...classNames,
    }}
    components={{
      Chevron: ({ orientation, ...rest }) =>
        orientation === 'left' ? (
          <ChevronLeft className="size-4" {...rest} />
        ) : (
          <ChevronRight className="size-4" {...rest} />
        ),
    }}
    {...props}
  />
)
Calendar.displayName = 'Calendar'
