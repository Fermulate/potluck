import type { GuestHeatCell } from '@potluck/api'
import { heatLevels } from '@potluck/core'
import { t } from '@potluck/i18n'
import { cn, HeatCell } from '@potluck/ui'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { HeatLegend } from '@/features/availability/availability-heatmap'
import { GridFrame } from '@/features/availability/grid-frame'
import { cellName } from '@/features/availability/grid-labels'
import { slotKey, step, type GridModel } from '@/features/availability/grid'

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

/**
 * The heatmap a guest sees: how many people are free per slot, never who. Same scale as the
 * members' heatmap (yes counts 1, maybe a half), against everyone who has answered.
 */
export function GuestHeatmap({
  model,
  heat,
  total,
  mine,
  label,
}: {
  model: GridModel
  heat: readonly GuestHeatCell[]
  /** People who have answered: the top of the scale. */
  total: number
  /** The guest's own slots, dotted. */
  mine?: ReadonlyMap<string, 'yes' | 'maybe'>
  label: string
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  // Start the readout on the warmest cell (earliest on a tie), so a phone shows something useful
  // before anyone taps; with no answers yet it starts empty.
  const best = useMemo(() => {
    let top: string | null = null
    let score = 0
    const bySlot = new Map(heat.map((h) => [slotKey(h.slot_start), h.yes + h.maybe * 0.5]))
    for (const slot of model.slots) {
      const s = bySlot.get(slot) ?? 0
      if (s > score) [top, score] = [slot, s]
    }
    return top
  }, [heat, model])
  const [picked, setPicked] = useState<string | null>(null)
  const active = picked ?? best
  const setActive = setPicked
  const [focus, setFocus] = useState(() => {
    const first = (best ?? model.slots[0]) || undefined
    return (first && model.index.get(first)) || { row: 0, col: 0 }
  })

  const cells = useMemo(() => {
    const bySlot = new Map(heat.map((h) => [slotKey(h.slot_start), h]))
    const counts = model.slots.map((s) => {
      const h = bySlot.get(s)
      return h ? h.yes + h.maybe * 0.5 : 0
    })
    const levels = heatLevels(counts, total)
    return new Map(
      model.slots.map((s, i) => [
        s,
        { level: levels[i]!, yes: bySlot.get(s)?.yes ?? 0, maybe: bySlot.get(s)?.maybe ?? 0 },
      ]),
    )
  }, [heat, model, total])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = ARROWS[e.key]
    const slot = (e.target as HTMLElement).dataset.slot
    const pos = slot ? model.index.get(slot) : undefined
    if (!dir || !pos) return
    e.preventDefault()
    const next = step(model, pos, dir[0], dir[1])
    if (!next) return
    setFocus(next)
    const target = model.cells[next.row]![next.col]!
    gridRef.current?.querySelector<HTMLElement>(`[data-slot="${target}"]`)?.focus()
  }

  const shown = active ? cells.get(active) : undefined

  return (
    <div className="flex flex-col gap-3">
      <div
        aria-live="polite"
        className="flex min-h-[3.25rem] items-center gap-3 rounded-[0.875rem] border border-line bg-card px-3.5 py-2.5"
      >
        {active && shown ? (
          <>
            <p className="min-w-0 flex-1 text-sm font-bold text-pretty">
              {cellName(model, active)}
            </p>
            <span className="shrink-0 tabular text-sm font-extrabold">
              {t('guests.page.cellCount', { count: shown.yes + shown.maybe, total })}
            </span>
          </>
        ) : (
          <p className="text-sm text-mute">{t('guests.page.tapHint')}</p>
        )}
      </div>
      <GridFrame
        ref={gridRef}
        model={model}
        label={label}
        onKeyDown={onKeyDown}

        renderCell={(slot, row, col) => {
          const cell = cells.get(slot)!
          return (
            <HeatCell
              role="gridcell"
              data-slot={slot}
              tabIndex={focus.row === row && focus.col === col ? 0 : -1}
              aria-label={t('availability.cellSummary', {
                time: cellName(model, slot),
                yes: cell.yes,
                maybe: cell.maybe,
              })}
              level={cell.level}
              mine={mine?.get(slot)}
              onPointerEnter={() => setActive(slot)}
              onPointerDown={() => setActive(slot)}
              onFocus={() => {
                setActive(slot)
                setFocus({ row, col })
              }}
              className={cn('min-h-0 outline-offset-1', active === slot && 'brightness-95')}
              style={{ height: '1.5rem' }}
            />
          )
        }}
      />
      <HeatLegend />
    </div>
  )
}
