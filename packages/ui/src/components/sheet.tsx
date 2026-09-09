import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import type { ComponentPropsWithoutRef, ElementRef, HTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/cn.ts'

/**
 * The mobile nav drawer. Built on Dialog rather than a bespoke overlay because
 * the drawer must trap focus and close on Escape exactly like a modal — the nav
 * links behind it are otherwise still tabbable.
 */
export const Sheet = DialogPrimitive.Root
export const SheetTrigger = DialogPrimitive.Trigger
export const SheetClose = DialogPrimitive.Close
export const SheetPortal = DialogPrimitive.Portal

const sheetVariants = cva(
  'fixed z-50 flex flex-col gap-4 border-line bg-card p-6 shadow-lg data-[state=open]:animate-ms-fade-up',
  {
    variants: {
      side: {
        top: 'inset-x-0 top-0 border-b rounded-b-panel',
        bottom: 'inset-x-0 bottom-0 border-t rounded-t-panel',
        left: 'inset-y-0 left-0 h-full w-80 max-w-[88vw] border-r',
        right: 'inset-y-0 right-0 h-full w-80 max-w-[88vw] border-l',
      },
    },
    defaultVariants: { side: 'right' },
  },
)

export const SheetOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-ink/45 backdrop-blur-[2px]', className)}
    {...props}
  />
))
SheetOverlay.displayName = 'SheetOverlay'

export interface SheetContentProps
  extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

export const SheetContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ side = 'right', className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        aria-label="Close menu"
        className={cn(
          'absolute right-4 top-4 grid size-8 place-items-center rounded-pill text-muted-2',
          'transition-colors duration-[0.18s] hover:bg-tint hover:text-ink',
        )}
      >
        <X className="size-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = 'SheetContent'

export const SheetHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />
)

export const SheetFooter = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('mt-auto flex flex-col gap-2.5', className)} {...props} />
)

export const SheetTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('font-display text-[20px] font-medium -tracking-[0.025em]', className)}
    {...props}
  />
))
SheetTitle.displayName = 'SheetTitle'

export const SheetDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-[14px] text-muted', className)}
    {...props}
  />
))
SheetDescription.displayName = 'SheetDescription'
