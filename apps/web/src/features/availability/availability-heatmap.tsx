import type { PlanMember } from '@potluck/api'
import { heatLevels } from '@potluck/core'
import { t } from '@potluck/i18n'
import { AvatarStack, cn, HeatCell, usePrefersReducedMotion } from '@potluck/ui'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { joinNames } from '@/features/plans/format'
import { Help } from '@/features/help/help'
import { GridFrame } from './grid-frame'
import { personName } from './person-name'
import { cellName } from './grid-labels'
import { step, type GridModel, type PaintLevel } from './grid'

export interface HeatRow {
  userId: string
  slot: string
  level: PaintLevel
}

export interface AvailabilityHeatmapProps {
  model: GridModel
  rows: readonly HeatRow[]
  members: readonly PlanMember[]
  busy?: ReadonlySet<string>
  /** Slots to outline, e.g. the best time being looked at. */
  highlight?: ReadonlySet<string>
  /** The viewer: their own cells get a dot. */
  viewerId?: string
  label: string
  avatarUrl?: (path: string | null) => string | null
}

interface SlotInfo {
  yes: string[]
  maybe: string[]
}

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

/**
 * Signature moment 2: the group's availability as heat. Yes counts 1, maybe counts half.
 * Cells warm up (and pulse) as new rows arrive over Realtime; hovering, tapping or focusing a
 * cell shows who is free.
 */
export function AvailabilityHeatmap({
  model,
  rows,
  members,
  busy,
  highlight,
  viewerId,
  label,
  avatarUrl,
}: AvailabilityHeatmapProps) {
  const reduced = usePrefersReducedMotion()
  const gridRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<string | null>(null)
  const [focus, setFocus] = useState(() => {
    const first = model.slots[0]
    return (first && model.index.get(first)) || { row: 0, col: 0 }
  })

  const people = useMemo(() => members.filter((m) => !m.deleted), [members])
  const byId = useMemo(() => new Map(people.map((m) => [m.userId, m])), [people])

  const info = useMemo(() => {
    const map = new Map<string, SlotInfo>()
    for (const row of rows) {
      if (!byId.has(row.userId) || !model.index.has(row.slot)) continue
      let entry = map.get(row.slot)
      if (!entry) map.set(row.slot, (entry = { yes: [], maybe: [] }))
      entry[row.level].push(row.userId)
    }
    return map
  }, [rows, byId, model])

  const levels = useMemo(() => {
    const counts = model.slots.map((s) => {
      const i = info.get(s)
      return i ? i.yes.length + i.maybe.length * 0.5 : 0
    })
    const out = heatLevels(counts, people.length)
    return new Map(model.slots.map((s, i) => [s, { level: out[i]!, count: counts[i]! }]))
  }, [info, model, people.length])

  // Pulse cells that just got warmer (someone painted them).
  const previous = useRef<Map<string, number> | null>(null)
  useEffect(() => {
    const prev = previous.current
    previous.current = new Map([...levels].map(([s, v]) => [s, v.count]))
    if (!prev || reduced) return
    for (const [slot, { count }] of levels) {
      if (count <= (prev.get(slot) ?? 0)) continue
      const el = gridRef.current?.querySelector<HTMLElement>(`[data-slot="${slot}"]`)
      el?.animate?.(
        [
          { transform: 'scale(1)', filter: 'brightness(1)' },
          { transform: 'scale(1.18)', filter: 'brightness(1.12)', offset: 0.35 },
          { transform: 'scale(1)', filter: 'brightness(1)' },
        ],
        { duration: 650, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      )
    }
  }, [levels, reduced])

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

  const shown = active ? info.get(active) : undefined
  const names = (ids: string[]) => ids.map((id) => personName(byId.get(id)))

  return (
    <div className="flex flex-col gap-3">
      <Inspector
        slotName={active ? cellName(model, active) : null}
        info={shown}
        total={people.length}
        people={byId}
        names={names}
        avatarUrl={avatarUrl}
      />
      <GridFrame
        ref={gridRef}
        model={model}
        label={label}
        onKeyDown={onKeyDown}
        onPointerLeave={() => setActive(null)}
        renderCell={(slot, row, col) => {
          const cell = levels.get(slot)!
          const i = info.get(slot)
          const yes = i?.yes.length ?? 0
          const maybe = i?.maybe.length ?? 0
          const mine = viewerId
            ? i?.yes.includes(viewerId)
              ? 'yes'
              : i?.maybe.includes(viewerId)
                ? 'maybe'
                : undefined
            : undefined
          return (
            <HeatCell
              role="gridcell"
              data-slot={slot}
              tabIndex={focus.row === row && focus.col === col ? 0 : -1}
              aria-label={t('availability.cellSummary', {
                time: cellName(model, slot),
                yes,
                maybe,
              })}
              level={cell.level}
              busy={busy?.has(slot)}
              selected={highlight?.has(slot)}
              mine={mine}
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
      <HeatLegend showBusy={!!busy && busy.size > 0} />
    </div>
  )
}

function Inspector({
  slotName,
  info,
  total,
  people,
  names,
  avatarUrl,
}: {
  slotName: string | null
  info: SlotInfo | undefined
  total: number
  people: Map<string, PlanMember>
  names: (ids: string[]) => string[]
  avatarUrl?: (path: string | null) => string | null
}) {
  const free = (info?.yes.length ?? 0) + (info?.maybe.length ?? 0)
  const faces = [...(info?.yes ?? []), ...(info?.maybe ?? [])].map((id) => {
    const p = people.get(id)
    return { id, name: p?.displayName ?? '', src: avatarUrl?.(p?.avatarPath ?? null) }
  })
  return (
    <div
      aria-live="polite"
      className="flex min-h-[3.75rem] items-center gap-3 rounded-[0.875rem] border border-line bg-card px-3.5 py-2.5 [--avatar-ring:var(--pl-card)]"
    >
      {slotName ? (
        <>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{slotName}</p>
            <p className="truncate text-xs text-mute">
              {free === 0
                ? t('availability.nobodyYet')
                : [
                    info?.yes.length
                      ? t('availability.freeNames', { names: joinNames(names(info.yes), 4) })
                      : null,
                    info?.maybe.length
                      ? t('availability.maybeNames', { names: joinNames(names(info.maybe), 3) })
                      : null,
                  ]
                    .filter(Boolean)
                    .join('. ')}
            </p>
          </div>
          {faces.length > 0 && <AvatarStack people={faces} size="xs" max={4} />}
          <span className="shrink-0 tabular text-sm font-extrabold">
            {t('availability.freeOf', { count: free, total })}
          </span>
        </>
      ) : (
        <p className="text-sm text-mute">{t('availability.instructionsHeat')}</p>
      )}
    </div>
  )
}

/** The heat scale, plus the hatched busy swatch when there is busy time on the grid to explain. */
export function HeatLegend({ showBusy = false }: { showBusy?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs text-mute">
      <span>{t('availability.heatLegendNobody')}</span>
      <span className="flex gap-0.5" aria-hidden>
        {([0, 1, 2, 3, 4] as const).map((l) => (
          <HeatCell key={l} level={l} className="size-3.5 min-h-0 rounded-[3px]" />
        ))}
      </span>
      <span>{t('availability.heatLegendAll')}</span>
      {showBusy && (
        <span className="ml-auto flex items-center gap-1.5">
          <HeatCell level={0} busy className="size-3.5 min-h-0 rounded-[3px]" aria-hidden />
          {t('availability.busy')}
        </span>
      )}
      <Help topic="heatmap" className={showBusy ? undefined : 'ml-auto'} />
    </div>
  )
}
