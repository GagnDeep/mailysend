import { Slot } from '@radix-ui/react-slot'
import { ChevronRight, MoreHorizontal } from 'lucide-react'
import type { AnchorHTMLAttributes, ComponentProps, HTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { cn } from '../lib/cn.ts'

export const Breadcrumb = forwardRef<HTMLElement, ComponentProps<'nav'>>(({ ...props }, ref) => (
  <nav ref={ref} aria-label="Breadcrumb" {...props} />
))
Breadcrumb.displayName = 'Breadcrumb'

export const BreadcrumbList = forwardRef<HTMLOListElement, HTMLAttributes<HTMLOListElement>>(
  ({ className, ...props }, ref) => (
    <ol
      ref={ref}
      className={cn('flex flex-wrap items-center gap-2 text-[13.5px] text-muted-2', className)}
      {...props}
    />
  ),
)
BreadcrumbList.displayName = 'BreadcrumbList'

export const BreadcrumbItem = forwardRef<HTMLLIElement, HTMLAttributes<HTMLLIElement>>(
  ({ className, ...props }, ref) => (
    <li ref={ref} className={cn('inline-flex items-center gap-2', className)} {...props} />
  ),
)
BreadcrumbItem.displayName = 'BreadcrumbItem'

export const BreadcrumbLink = forwardRef<
  HTMLAnchorElement,
  AnchorHTMLAttributes<HTMLAnchorElement> & { asChild?: boolean }
>(({ className, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : 'a'
  return <Comp ref={ref} className={cn('transition-colors hover:text-ink', className)} {...props} />
})
BreadcrumbLink.displayName = 'BreadcrumbLink'

/** The trailing segment. `aria-current` is what makes it the current page. */
export const BreadcrumbPage = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      aria-current="page"
      className={cn('font-semibold text-ink', className)}
      {...props}
    />
  ),
)
BreadcrumbPage.displayName = 'BreadcrumbPage'

export const BreadcrumbSeparator = ({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLLIElement>) => (
  <li role="presentation" aria-hidden="true" className={cn('text-muted-3', className)} {...props}>
    {children ?? <ChevronRight className="size-3.5" />}
  </li>
)

export const BreadcrumbEllipsis = ({ className, ...props }: HTMLAttributes<HTMLSpanElement>) => (
  <span
    role="presentation"
    className={cn('flex size-5 items-center justify-center', className)}
    {...props}
  >
    <MoreHorizontal className="size-3.5" />
    <span className="sr-only">More</span>
  </span>
)
