import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  shape?: 'block' | 'line' | 'circle' | 'pill'
}

const shapes = {
  block: 'rounded-card',
  line: 'h-3.5 rounded-pill',
  circle: 'rounded-full',
  pill: 'h-9 rounded-pill',
} as const

/**
 * Loading placeholder with a slow warm shimmer. Decorative: wrap a group of
 * skeletons in an element with `aria-busy` and a label instead.
 */
export function Skeleton({ shape = 'block', className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer bg-[linear-gradient(100deg,var(--pl-sunken)_30%,var(--pl-line)_50%,var(--pl-sunken)_70%)] bg-[length:200%_100%]',
        shapes[shape],
        className,
      )}
      {...props}
    />
  )
}
