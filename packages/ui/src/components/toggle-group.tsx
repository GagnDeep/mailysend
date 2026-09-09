import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import type { ComponentPropsWithoutRef, ElementRef } from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/cn.ts'

/**
 * The time-range chip row (`24h` `7d` `30d` `90d`) on Analytics. It is a
 * single-select segmented control, so it must be a toggle group and not a tab
 * list — nothing is being shown or hidden by it directly.
 */
export const ToggleGroup = forwardRef<
  ElementRef<typeof ToggleGroupPrimitive.Root>,
  ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn('flex flex-wrap items-center gap-2', className)}
    {...props}
  />
))
ToggleGroup.displayName = 'ToggleGroup'

export const ToggleGroupItem = forwardRef<
  ElementRef<typeof ToggleGroupPrimitive.Item>,
  ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      'rounded-[7px] bg-tint px-2.5 py-1.5 font-mono text-[11.5px] text-muted',
      'transition-colors duration-[0.18s] hover:text-ink',
      'data-[state=on]:bg-ink data-[state=on]:text-paper',
      'disabled:pointer-events-none disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
ToggleGroupItem.displayName = 'ToggleGroupItem'
