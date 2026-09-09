import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { ComponentPropsWithoutRef, ElementRef } from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/cn.ts'

export const Switch = forwardRef<
  ElementRef<typeof SwitchPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-[22px] w-10 shrink-0 items-center rounded-pill border border-transparent p-0.5',
      'transition-colors duration-[0.18s] disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=unchecked]:bg-muted-3 data-[state=checked]:bg-accent',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block size-[18px] rounded-pill bg-card shadow-sm',
        'transition-transform duration-[0.18s] data-[state=unchecked]:translate-x-0 data-[state=checked]:translate-x-[18px]',
      )}
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = 'Switch'
