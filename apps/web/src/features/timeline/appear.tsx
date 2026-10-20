import { springs, STAGGER } from '@potluck/tokens'
import { usePrefersReducedMotion } from '@potluck/ui'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'

/** Fades and lifts its child in, staggered by `index`. Reduced motion: fade only. */
export function Appear({
  index = 0,
  className,
  children,
  as = 'div',
}: {
  index?: number
  className?: string
  children: ReactNode
  as?: 'div' | 'li' | 'section'
}) {
  const reduced = usePrefersReducedMotion()
  const Tag = motion[as]
  return (
    <Tag
      className={className}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduced
          ? { duration: 0.2, delay: index * STAGGER }
          : { ...springs.default, delay: index * STAGGER }
      }
    >
      {children}
    </Tag>
  )
}
