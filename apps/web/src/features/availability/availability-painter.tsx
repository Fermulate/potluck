import { t } from '@potluck/i18n'
import { cn, HeatCell, SegmentedControl } from '@potluck/ui'
import { Eraser, Paintbrush, CircleHelp } from 'lucide-react'
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { GridFrame } from './grid-frame'
import { cellName } from './grid-labels'
import { slotsInRect, step, type GridModel, type PaintLevel } from './grid'

export type Brush = PaintLevel | 'erase'

export interface AvailabilityPainterProps {
  model: GridModel
  value: ReadonlyMap<string, PaintLevel>
  onChange: (next: Map<string, PaintLevel>) => void
  /** Slots that overlap the viewer's imported busy time (hatched). */
  busy?: ReadonlySet<string>
  label: string
}

interface Pos {
  row: number
  col: number
}

interface Drag {
  pointerId: number
  anchor: Pos
  base: Map<string, PaintLevel>
  paint: PaintLevel | null
  last: string
}

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

function slotAt(target: EventTarget | null): string | undefined {
  return (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-slot]')?.dataset.slot
}

/**
 * Signature moment 3: paint your availability. Press and drag paints a rectangle (touch,
 * mouse, pen); arrow keys move, Space paints, Shift with an arrow paints as you go. Starting
 * on a cell that already has the brush's level erases instead, like a toggle.
 */
export function AvailabilityPainter({
  model,
  value,
  onChange,
  busy,
  label,
}: AvailabilityPainterProps) {
  const [brush, setBrush] = useState<Brush>('yes')
  const [focus, setFocus] = useState<Pos>(() => {
    const first = model.slots[0]
    return (first && model.index.get(first)) || { row: 0, col: 0 }
  })
  const [dragging, setDragging] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const keyPaint = useRef<PaintLevel | null | undefined>(undefined)

  const paintFor = (slot: string): PaintLevel | null => {
    if (brush === 'erase') return null
    return value.get(slot) === brush ? null : brush
  }

  const applyRect = (
    base: ReadonlyMap<string, PaintLevel>,
    a: Pos,
    b: Pos,
    paint: PaintLevel | null,
  ) => {
    const next = new Map(base)
    for (const slot of slotsInRect(model, a, b)) {
      if (paint) next.set(slot, paint)
      else next.delete(slot)
    }
    onChange(next)
  }

  const focusCell = (pos: Pos) => {
    setFocus(pos)
    const slot = model.cells[pos.row]?.[pos.col]
    if (!slot) return
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-slot="${slot}"]`)
      ?.focus({ preventScroll: false })
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const slot = slotAt(e.target)
    const pos = slot ? model.index.get(slot) : undefined
    if (!slot || !pos) return
    e.preventDefault()
    const paint = paintFor(slot)
    drag.current = { pointerId: e.pointerId, anchor: pos, base: new Map(value), paint, last: slot }
    gridRef.current?.setPointerCapture?.(e.pointerId)
    setDragging(true)
    focusCell(pos)
    applyRect(value, pos, pos, paint)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const hit =
      typeof document.elementFromPoint === 'function'
        ? document.elementFromPoint(e.clientX, e.clientY)
        : null
    const slot = slotAt(hit ?? e.target)
    if (!slot || slot === d.last) return
    const pos = model.index.get(slot)
    if (!pos) return
    d.last = slot
    applyRect(d.base, d.anchor, pos, d.paint)
  }

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    setDragging(false)
    if (gridRef.current?.hasPointerCapture?.(e.pointerId)) {
      gridRef.current.releasePointerCapture(e.pointerId)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const slot = slotAt(e.target)
    const pos = slot ? model.index.get(slot) : undefined
    if (!slot || !pos) return

    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      const paint = paintFor(slot)
      keyPaint.current = paint
      applyRect(value, pos, pos, paint)
      return
    }

    const dir = ARROWS[e.key]
    if (!dir) {
      if (!e.shiftKey) keyPaint.current = undefined
      return
    }
    e.preventDefault()
    const next = step(model, pos, dir[0], dir[1])
    if (!next) return
    if (e.shiftKey) {
      // Extend: carry the last painted value (or start one from this cell) onto the next cell.
      let paint = keyPaint.current
      let base: ReadonlyMap<string, PaintLevel> = value
      if (paint === undefined) {
        paint = paintFor(slot)
        keyPaint.current = paint
        const withStart = new Map(value)
        if (paint) withStart.set(slot, paint)
        else withStart.delete(slot)
        base = withStart
      }
      applyRect(base, next, next, paint)
    } else {
      keyPaint.current = undefined
    }
    focusCell(next)
  }

  const count = value.size

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <SegmentedControl<Brush>
          label={t('availability.modes.label')}
          size="sm"
          value={brush}
          onValueChange={(b) => {
            setBrush(b)
            keyPaint.current = undefined
          }}
          options={[
            {
              value: 'yes',
              label: t('availability.modes.yes'),
              icon: <Paintbrush aria-hidden className="size-3.5" />,
            },
            {
              value: 'maybe',
              label: t('availability.modes.maybe'),
              icon: <CircleHelp aria-hidden className="size-3.5" />,
            },
            {
              value: 'erase',
              label: t('availability.modes.erase'),
              icon: <Eraser aria-hidden className="size-3.5" />,
            },
          ]}
        />
        <span className="tabular text-xs font-semibold text-mute" aria-live="polite">
          {t('availability.mySlots', { count })}
        </span>
      </div>
      <p className="text-sm text-mute">
        {t('availability.instructions')}{' '}
        <span className="hidden sm:inline">{t('availability.keyboardHint')}</span>
      </p>
      <GridFrame
        ref={gridRef}
        model={model}
        label={label}
        aria-multiselectable
        aria-describedby={undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className={cn(dragging && 'cursor-crosshair')}
        renderCell={(slot, row, col) => {
          const level = value.get(slot)
          const isBusy = busy?.has(slot) ?? false
          const focused = focus.row === row && focus.col === col
          const state = level ? t(`availability.levels.${level}`) : t('availability.cellUnset')
          return (
            <HeatCell
              role="gridcell"
              data-slot={slot}
              tabIndex={focused ? 0 : -1}
              aria-selected={!!level}
              aria-label={`${t('availability.cellMine', { time: cellName(model, slot), state })}${isBusy ? t('availability.cellBusySuffix') : ''}`}
              level={level === 'yes' ? 4 : level === 'maybe' ? 2 : 0}
              mine={level === 'maybe' ? 'maybe' : undefined}
              busy={isBusy}
              onFocus={() => setFocus({ row, col })}
              className={cn(
                'min-h-0 cursor-pointer touch-none outline-offset-1',
                level === 'yes' && 'shadow-[inset_0_-2px_0_rgb(0_0_0/0.12)]',
              )}
              style={{ height: '1.5rem' }}
            />
          )
        }}
      />
    </div>
  )
}
