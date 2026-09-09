import * as AccordionPrimitive from '@radix-ui/react-accordion'
import type { ComponentPropsWithoutRef, ElementRef } from 'react'
import { createContext, forwardRef, useContext, useState } from 'react'
import { cn } from '../lib/cn.ts'

/**
 * The FAQ accordion draws a `+` next to every question — including the one that
 * is already open, which is the bug we are fixing. The glyph has to become `−`,
 * and it has to be a real text node rather than a CSS `::after` so that a
 * screen reader reading the trigger and a test asserting on it see the same
 * thing. That requires knowing the open set at render time, which Radix only
 * exposes through `value`/`onValueChange` — hence the mirror below.
 */
const OpenValuesContext = createContext<readonly string[]>([])
const ItemValueContext = createContext<string>('')

const toArray = (value: string | string[] | undefined): string[] => {
  if (value === undefined) return []
  if (Array.isArray(value)) return value
  return value === '' ? [] : [value]
}

export type AccordionProps = ComponentPropsWithoutRef<typeof AccordionPrimitive.Root>

export const Accordion = ({ className, children, ...props }: AccordionProps) => {
  const bag = props as {
    value?: string | string[]
    defaultValue?: string | string[]
    onValueChange?: (value: never) => void
  }
  const [uncontrolled, setUncontrolled] = useState<string[]>(() => toArray(bag.defaultValue))
  const open = bag.value !== undefined ? toArray(bag.value) : uncontrolled

  const handleValueChange = (value: string | string[]) => {
    if (bag.value === undefined) setUncontrolled(toArray(value))
    bag.onValueChange?.(value as never)
  }

  return (
    <OpenValuesContext.Provider value={open}>
      <AccordionPrimitive.Root
        {...(props as AccordionProps)}
        onValueChange={handleValueChange as never}
        className={cn('flex flex-col gap-2.5', className)}
      >
        {children}
      </AccordionPrimitive.Root>
    </OpenValuesContext.Provider>
  )
}

export const AccordionItem = forwardRef<
  ElementRef<typeof AccordionPrimitive.Item>,
  ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, value, ...props }, ref) => (
  <ItemValueContext.Provider value={value}>
    <AccordionPrimitive.Item
      ref={ref}
      value={value}
      className={cn('overflow-hidden rounded-tile border border-line bg-card', className)}
      {...props}
    />
  </ItemValueContext.Provider>
))
AccordionItem.displayName = 'AccordionItem'

export const AccordionTrigger = forwardRef<
  ElementRef<typeof AccordionPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>
>(({ className, children, ...props }, ref) => {
  const open = useContext(OpenValuesContext)
  const value = useContext(ItemValueContext)
  const isOpen = open.includes(value)

  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        ref={ref}
        className={cn(
          'flex w-full items-center gap-4 px-[22px] py-5 text-left text-[16.5px] font-semibold text-ink',
          'transition-colors duration-[0.18s] hover:text-accent',
          className,
        )}
        {...props}
      >
        <span className="flex-1">{children}</span>
        <span aria-hidden="true" className="font-mono text-accent">
          {isOpen ? '−' : '+'}
        </span>
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
})
AccordionTrigger.displayName = 'AccordionTrigger'

export const AccordionContent = forwardRef<
  ElementRef<typeof AccordionPrimitive.Content>,
  ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Content ref={ref} className="overflow-hidden" {...props}>
    <div className={cn('px-[22px] pb-5 text-[15.5px] leading-[1.7] text-muted', className)}>
      {children}
    </div>
  </AccordionPrimitive.Content>
))
AccordionContent.displayName = 'AccordionContent'
