import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import type { AnchorHTMLAttributes, ComponentProps, HTMLAttributes } from 'react'
import { cn } from '../lib/cn.ts'
import { buttonVariants } from './button.tsx'

export const Pagination = ({ className, ...props }: ComponentProps<'nav'>) => (
  <nav aria-label="Pagination" className={cn('flex w-full justify-center', className)} {...props} />
)

export const PaginationContent = ({ className, ...props }: HTMLAttributes<HTMLUListElement>) => (
  <ul className={cn('flex flex-row items-center gap-1', className)} {...props} />
)

export const PaginationItem = ({ className, ...props }: HTMLAttributes<HTMLLIElement>) => (
  <li className={cn('', className)} {...props} />
)

export interface PaginationLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  isActive?: boolean
  size?: 'sm' | 'md'
}

export const PaginationLink = ({
  className,
  isActive,
  size = 'sm',
  ...props
}: PaginationLinkProps) => (
  <a
    // A page link is the current page, not a selected control, so `aria-current`
    // carries the state rather than `aria-selected`.
    aria-current={isActive ? 'page' : undefined}
    className={cn(
      buttonVariants({ variant: isActive ? 'primary' : 'ghost', size }),
      'min-w-9 px-3 font-mono text-[12.5px]',
      className,
    )}
    {...props}
  />
)

export const PaginationPrevious = ({ className, ...props }: PaginationLinkProps) => (
  <PaginationLink
    aria-label="Go to previous page"
    className={cn('gap-1 pl-2.5', className)}
    {...props}
  >
    <ChevronLeft className="size-4" />
    <span>Previous</span>
  </PaginationLink>
)

export const PaginationNext = ({ className, ...props }: PaginationLinkProps) => (
  <PaginationLink aria-label="Go to next page" className={cn('gap-1 pr-2.5', className)} {...props}>
    <span>Next</span>
    <ChevronRight className="size-4" />
  </PaginationLink>
)

export const PaginationEllipsis = ({ className, ...props }: HTMLAttributes<HTMLSpanElement>) => (
  <span
    aria-hidden="true"
    className={cn('flex size-9 items-center justify-center text-muted-2', className)}
    {...props}
  >
    <MoreHorizontal className="size-4" />
    <span className="sr-only">More pages</span>
  </span>
)
