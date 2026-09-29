import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from './cn'

export type HeatLevel = 0 | 1 | 2 | 3 | 4

const levels: Record<HeatLevel, string> = {
  0: 'bg-heat-0',
  1: 'bg-heat-1',
  2: 'bg-heat-2',
  3: 'bg-heat-3',
  4: 'bg-heat-4',
}

export interface HeatCellProps extends HTMLAttributes<HTMLDivElement> {
  /** 0 (nobody free) to 4 (everyone). Use `heatLevel(count, max)` from tokens. */
  level: HeatLevel
  /** Imported busy time: hatched. */
  busy?: boolean
  /** Part of the current pick or the hovered best slot. */
  selected?: boolean
  /** The viewer marked this slot: a small dot. */
  mine?: 'yes' | 'maybe'
}

/**
 * One slot in the availability grid. Purely visual; the painter owns pointer
 * and keyboard handling and should give each cell an aria-label.
 */
export const HeatCell = forwardRef<HTMLDivElement, HeatCellProps>(function HeatCell(
  { level, busy, selected, mine, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-level={level}
      data-selected={selected || undefined}
      className={cn(
        'relative h-full min-h-6 w-full rounded-[0.3125rem] transition-[background-color,box-shadow] duration-300 ease-out',
        levels[level],
        busy &&
          'bg-[repeating-linear-gradient(135deg,transparent_0_4px,color-mix(in_oklab,var(--color-ink)_14%,transparent)_4px_5px)]',
        selected && 'shadow-[0_0_0_2px_var(--color-ink)]',
        className,
      )}
      {...props}
    >
      {mine && (
        <span
          aria-hidden
          className={cn(
            'absolute top-1/2 left-1/2 size-1.5 -translate-1/2 rounded-full',
            mine === 'yes' ? 'bg-ink' : 'border border-ink',
          )}
        />
      )}
    </div>
  )
})
