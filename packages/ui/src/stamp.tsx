import { springs } from '@potluck/tokens'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from './cn'
import { usePrefersReducedMotion } from './hooks'

export interface StampAnimationProps {
  /** When true, the child stamps in; when false, it fades away. */
  show: boolean
  /** Resting tilt in degrees. */
  rotate?: number
  className?: string
  children: ReactNode
}

/**
 * Brings its child down like a rubber stamp: oversized and tilted, then a
 * hard landing with a little settle. Reduced motion gets a fade.
 */
export function StampAnimation({ show, rotate = -6, className, children }: StampAnimationProps) {
  const reduced = usePrefersReducedMotion()
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className={cn('relative inline-flex', className)}
          initial={
            reduced ? { opacity: 0 } : { opacity: 0, scale: 1.9, rotate: rotate - 14, y: -18 }
          }
          animate={{ opacity: 1, scale: 1, rotate, y: 0 }}
          exit={{ opacity: 0, scale: reduced ? 1 : 0.9 }}
          transition={reduced ? { duration: 0.2 } : springs.bouncy}
        >
          {!reduced && (
            <motion.span
              aria-hidden
              className="absolute inset-[-10%] rounded-[inherit] border-2 border-current"
              initial={{ opacity: 0.5, scale: 0.9 }}
              animate={{ opacity: 0, scale: 1.35 }}
              transition={{ delay: 0.12, duration: 0.5, ease: 'easeOut' }}
            />
          )}
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export interface StampProps {
  children: ReactNode
  /** Small line above the main text, e.g. the date. */
  caption?: ReactNode
  tone?: 'tomato' | 'olive' | 'plum' | 'ink'
  className?: string
}

const stampTones = {
  tomato: 'text-tomato-ink',
  olive: 'text-olive-ink',
  plum: 'text-plum-ink',
  ink: 'text-ink',
} as const

// Speckled alpha so the stamp reads as ink pressed onto paper, not a flat badge.
const INK_TEXTURE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='i'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.75' numOctaves='2' seed='7'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2.4 2.15'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23i)'/%3E%3C/svg%3E\")"

/** A rubber-stamp mark: double rule, inked letters, slightly uneven. */
export function Stamp({ children, caption, tone = 'tomato', className }: StampProps) {
  return (
    <span
      className={cn(
        'relative inline-flex flex-col items-center rounded-[0.625rem] border-[2.5px] border-current px-3 py-1.5 text-center leading-none',
        'outline-[1.5px] outline-offset-[-6px] outline-current',
        stampTones[tone],
        className,
      )}
      style={{ maskImage: INK_TEXTURE, WebkitMaskImage: INK_TEXTURE, maskSize: '120px 120px' }}
    >
      {caption && (
        <span className="mb-1 text-[0.625rem] font-bold tracking-[0.08em]">{caption}</span>
      )}
      <span className="text-lg font-extrabold tracking-tight">{children}</span>
    </span>
  )
}
