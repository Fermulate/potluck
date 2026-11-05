import { avatarColor, springs } from '@potluck/tokens'
import { t } from '@potluck/i18n'
import { Avatar, cn, usePrefersReducedMotion } from '@potluck/ui'
import { motion } from 'motion/react'
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { FULL, moveBoundary } from './split-state'

export interface SliderPerson {
  id: string
  name: string
  avatarSrc?: string | null
}

const STEP = 100 // 1%

function pct(bp: number): string {
  const value = bp / 100
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '')
}

/**
 * Signature moment: one bar, one colored segment per person. Drag a handle (or use the arrow
 * keys on it) to move share between the two neighbours; everyone else stays put, so the total
 * is always exactly 100%. Avatars ride on top of their segment and hop as it changes.
 */
export function PercentSlider({
  people,
  percent,
  onChange,
}: {
  people: SliderPerson[]
  percent: Record<string, number>
  onChange: (next: Record<string, number>) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()
  const [dragging, setDragging] = useState<number | null>(null)
  const order = people.map((p) => p.id)

  let running = 0
  const segments = people.map((p) => {
    const value = percent[p.id] ?? 0
    const start = running
    running += value
    return { ...p, value, start, color: avatarColor(p.id) }
  })

  const setBoundary = (index: number, cumulative: number) => {
    const snapped = Math.round(cumulative / STEP) * STEP
    const next = moveBoundary(percent, order, index, snapped)
    if (next[order[index]!] !== percent[order[index]!]) onChange(next)
  }

  const fromPointer = (e: PointerEvent) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    return ((e.clientX - rect.left) / rect.width) * FULL
  }

  const onPointerDown = (index: number) => (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    setDragging(index)
  }

  const onPointerMove = (index: number) => (e: PointerEvent<HTMLDivElement>) => {
    if (dragging !== index) return
    const at = fromPointer(e)
    if (at !== null) setBoundary(index, at)
  }

  const onKeyDown = (index: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    const boundary = segments[index]!.start + segments[index]!.value
    const big = e.shiftKey ? 5 : 1
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = boundary + STEP * big
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = boundary - STEP * big
    else if (e.key === 'PageUp') next = boundary + STEP * 10
    else if (e.key === 'PageDown') next = boundary - STEP * 10
    else if (e.key === 'Home') next = segments[index]!.start
    else if (e.key === 'End') next = segments[index + 1]!.start + segments[index + 1]!.value
    if (next === null) return
    e.preventDefault()
    setBoundary(index, next)
  }

  const transition = reduced ? { duration: 0 } : springs.default

  return (
    <div className="relative pt-12 pb-1 select-none">
      {/* Avatars ride above the middle of their segment. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-11">
        {segments.map((s) => (
          <motion.div
            key={s.id}
            className="absolute top-0 -translate-x-1/2"
            initial={false}
            animate={{
              left: `${((s.start + s.value / 2) / FULL) * 100}%`,
              // A bigger slice gets a slightly bigger face.
              scale: s.value === 0 ? 0.7 : 0.9 + 0.35 * (s.value / FULL),
              opacity: s.value === 0 ? 0.45 : 1,
            }}
            transition={transition}
          >
            <Avatar name={s.name} seed={s.id} src={s.avatarSrc} size="sm" ring />
          </motion.div>
        ))}
      </div>

      <div
        ref={trackRef}
        className="relative flex h-12 w-full overflow-hidden rounded-pill border border-line-strong bg-sunken"
      >
        {segments.map((s) => (
          <motion.div
            key={s.id}
            className="flex h-full min-w-0 items-center justify-center overflow-hidden"
            style={{ backgroundColor: s.color.bg, color: s.color.fg }}
            initial={false}
            animate={{ width: `${(s.value / FULL) * 100}%` }}
            transition={dragging !== null || reduced ? { duration: 0 } : springs.snappy}
          >
            {s.value >= 900 && (
              <span aria-hidden className="truncate px-1 tabular text-sm font-bold">
                {pct(s.value)}%
              </span>
            )}
          </motion.div>
        ))}
      </div>

      {segments.slice(0, -1).map((s, index) => {
        const right = segments[index + 1]!
        const boundary = s.start + s.value
        return (
          <div
            key={`${s.id}-${right.id}`}
            role="slider"
            tabIndex={0}
            aria-label={t('expenses.splitEditor.handle', { left: s.name, right: right.name })}
            aria-valuemin={s.start / 100}
            aria-valuemax={(right.start + right.value) / 100}
            aria-valuenow={boundary / 100}
            aria-valuetext={`${s.name} ${pct(s.value)}%, ${right.name} ${pct(right.value)}%`}
            onPointerDown={onPointerDown(index)}
            onPointerMove={onPointerMove(index)}
            onPointerUp={() => setDragging(null)}
            onPointerCancel={() => setDragging(null)}
            onKeyDown={onKeyDown(index)}
            className={cn(
              'group absolute top-12 z-10 flex h-12 w-8 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center outline-none',
            )}
            style={{ left: `${(boundary / FULL) * 100}%` }}
          >
            <span
              className={cn(
                'h-14 w-3 rounded-pill border-2 border-ink bg-card shadow-pop transition-transform duration-150',
                'group-focus-visible:ring-2 group-focus-visible:ring-focus group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-card',
                dragging === index && 'scale-x-125',
              )}
            />
          </div>
        )
      })}
    </div>
  )
}
