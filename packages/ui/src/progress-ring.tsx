import { springs } from '@potluck/tokens'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from './cn'
import { usePrefersReducedMotion } from './hooks'

export interface ProgressRingProps {
  /** 0 to 1. */
  value: number
  /** Accessible name, e.g. "Responses". */
  label: string
  /** Read out instead of a percentage, e.g. "4 of 6 replied". */
  valueText?: string
  size?: number
  thickness?: number
  tone?: 'tomato' | 'saffron' | 'olive' | 'plum' | 'ink'
  /** Centered content, e.g. "4/6". */
  children?: ReactNode
  className?: string
}

const strokes = {
  tomato: 'stroke-tomato',
  saffron: 'stroke-saffron',
  olive: 'stroke-olive',
  plum: 'stroke-plum',
  ink: 'stroke-ink',
} as const

export function ProgressRing({
  value,
  label,
  valueText,
  size = 48,
  thickness = 5,
  tone = 'tomato',
  children,
  className,
}: ProgressRingProps) {
  const reduced = usePrefersReducedMotion()
  const clamped = Math.min(1, Math.max(0, value))
  const r = (size - thickness) / 2
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuetext={valueText}
      className={cn('relative inline-grid shrink-0 place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={thickness}
          className="stroke-line"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={thickness}
          strokeLinecap="round"
          className={strokes[tone]}
          initial={{ pathLength: reduced ? clamped : 0 }}
          animate={{ pathLength: clamped }}
          transition={reduced ? { duration: 0 } : springs.gentle}
        />
      </svg>
      {children && (
        <span className="absolute inset-0 grid place-items-center text-xs font-bold tabular">
          {children}
        </span>
      )}
    </div>
  )
}
