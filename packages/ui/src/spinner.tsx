import { SPINNER_DELAY_MS } from '@potluck/tokens'
import { useDelayedFlag } from './hooks'
import { cn } from './cn'

/** Decorative loading dots (a table being set). Hidden from assistive tech. */
export function LoadingDots({ size = 20, className }: { size?: number; className?: string }) {
  const dot = Math.max(4, Math.round(size / 4))
  return (
    <span
      aria-hidden
      className={cn('inline-flex items-center justify-center gap-[0.2em]', className)}
      style={{ height: size, width: size * 1.4 }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="animate-dot rounded-full bg-current"
          style={{ width: dot, height: dot, animationDelay: `${i * 120}ms` }}
        />
      ))}
    </span>
  )
}

export interface SpinnerProps {
  /** Accessible label, e.g. "Loading balances". */
  label: string
  /** Size in px. */
  size?: number
  /** Wait before showing. Defaults to 300ms so fast loads never flash a spinner. */
  delayMs?: number
  className?: string
}

/**
 * Status indicator, hidden for the first 300ms. Prefer `Skeleton` for anything
 * with a known shape.
 */
export function Spinner({ label, size = 20, delayMs = SPINNER_DELAY_MS, className }: SpinnerProps) {
  const visible = useDelayedFlag(true, delayMs)
  if (!visible) return null
  return (
    <span role="status" aria-label={label} className={cn('inline-flex', className)}>
      <LoadingDots size={size} />
    </span>
  )
}
