import type { HTMLAttributes } from 'react'
import { cn } from '../lib/cn.ts'

export const Skeleton = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    aria-hidden="true"
    className={cn('animate-pulse rounded-md bg-tint', className)}
    {...props}
  />
)
