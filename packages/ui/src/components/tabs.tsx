import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { ComponentPropsWithoutRef, ElementRef } from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/cn.ts'

/**
 * The artboards draw tabs as bare `<button>`s with no roles, so a screen reader
 * announces six unrelated buttons and the arrow keys do nothing. Radix supplies
 * `role="tab"`, `aria-selected`, `aria-controls` and roving-focus arrow keys —
 * that is the entire reason this is not hand-rolled.
 */
export const Tabs = TabsPrimitive.Root

export const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { tone?: 'paper' | 'dark' }
>(({ className, tone = 'paper', ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'flex flex-wrap items-center gap-1 border-b p-3.5',
      tone === 'paper' ? 'border-line' : 'border-dark-line-soft',
      className,
    )}
    {...props}
  />
))
TabsList.displayName = 'TabsList'

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { tone?: 'paper' | 'dark' }
>(({ className, tone = 'paper', ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'rounded-md px-3.5 py-2.5 text-[13.5px] font-semibold transition-colors duration-[0.18s]',
      'disabled:pointer-events-none disabled:opacity-50',
      tone === 'paper'
        ? 'text-muted hover:text-ink data-[state=active]:bg-ink data-[state=active]:text-paper'
        : 'text-muted-2 hover:text-paper data-[state=active]:bg-dark-line-soft data-[state=active]:text-paper',
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = 'TabsTrigger'

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('min-w-0', className)} {...props} />
))
TabsContent.displayName = 'TabsContent'
