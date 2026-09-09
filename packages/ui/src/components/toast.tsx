import type { ComponentProps } from 'react'
import { Toaster as SonnerToaster, toast } from 'sonner'

export type { ExternalToast } from 'sonner'
export { toast }

/**
 * sonner ships its own palette. Every surface is re-pointed at the tokens here
 * rather than in a stylesheet, because the toaster is mounted once by the app
 * shell and this is the only place its look is decided.
 */
export const Toaster = ({ toastOptions, ...props }: ComponentProps<typeof SonnerToaster>) => (
  <SonnerToaster
    position="bottom-right"
    gap={10}
    toastOptions={{
      ...toastOptions,
      classNames: {
        toast:
          'group flex w-full items-center gap-3 rounded-tile border border-line bg-card p-3.5 text-[14px] text-ink shadow-md',
        title: 'text-[14px] font-semibold text-ink',
        description: 'text-[13px] text-muted',
        actionButton: 'rounded-pill bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-paper',
        cancelButton: 'rounded-pill bg-tint px-3 py-1.5 text-[12.5px] font-semibold text-muted',
        closeButton: 'rounded-pill border-line bg-card text-muted-2',
        success: 'border-positive/25 bg-positive-bg [&_[data-icon]]:text-positive',
        error: 'border-accent-border bg-accent-soft [&_[data-icon]]:text-warning',
        warning: 'border-accent-border bg-accent-soft [&_[data-icon]]:text-accent',
        info: 'border-line bg-card [&_[data-icon]]:text-muted-2',
        ...toastOptions?.classNames,
      },
    }}
    {...props}
  />
)
