// biome-ignore-all lint/suspicious/noArrayIndexKey: a thumb has no identity beyond its position.

import * as SliderPrimitive from '@radix-ui/react-slider'
import type { ComponentPropsWithoutRef, ElementRef } from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/cn.ts'

/**
 * The volume slider that drives the cost calculators. Radix rather than a bare
 * `input[type=range]` because the artboards style the native thumb differently
 * in WebKit (22px) and Firefox (18px), and because the calculator needs the
 * thumb to carry `aria-valuetext` in emails-per-month rather than raw digits.
 */
export const Slider = forwardRef<
  ElementRef<typeof SliderPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => {
  // A range slider needs one thumb per value; Radix will not infer them.
  const thumbs = props.value ?? props.defaultValue ?? [props.min ?? 0]
  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn('relative flex w-full touch-none select-none items-center', className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-pill bg-line">
        <SliderPrimitive.Range className="absolute h-full bg-accent" />
      </SliderPrimitive.Track>
      {thumbs.map((_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          className={cn(
            'block size-[22px] rounded-pill border-[3px] border-card bg-accent shadow-md',
            'transition-colors duration-[0.18s] hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50',
          )}
        />
      ))}
    </SliderPrimitive.Root>
  )
})
Slider.displayName = 'Slider'
