import { buildSlots } from '@potluck/core'

export type PaintLevel = 'yes' | 'maybe'

export interface GridEvent {
  window_start: string
  window_end: string
  day_start_minute: number
  day_end_minute: number
  slot_minutes: number
  timezone: string
}

export interface GridDay {
  /** `YYYY-MM-DD` in the viewer's zone. */
  key: string
  /** Noon UTC of that calendar day, safe to format in UTC. */
  date: Date
}

export interface GridRow {
  /** Minutes after local midnight in the viewer's zone. */
  minute: number
}

export interface GridModel {
  days: GridDay[]
  rows: GridRow[]
  /** cells[row][col]: the slot's UTC ISO start, or null where the poll has no cell. */
  cells: (string | null)[][]
  /** Every slot, ascending. */
  slots: string[]
  /** Slot ISO to its position. */
  index: Map<string, { row: number; col: number }>
  slotMinutes: number
  timeZone: string
}

const partsFormats = new Map<string, Intl.DateTimeFormat>()

function zonedParts(date: Date, timeZone: string) {
  let format = partsFormats.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    partsFormats.set(timeZone, format)
  }
  const parts = format.formatToParts(date)
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return {
    day: `${pick('year')}-${pick('month')}-${pick('day')}`,
    minute: Number(pick('hour')) * 60 + Number(pick('minute')),
  }
}

/** Normalize any timestamptz text (`2026-06-12 18:00:00+00`, ISO) to a UTC ISO string. */
export function slotKey(value: string | Date): string {
  if (value instanceof Date) return value.toISOString()
  const iso = value
    .trim()
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00')
  return new Date(iso).toISOString()
}

/**
 * Lays an event's slots out as days (columns) by times of day (rows), in the viewer's zone.
 * When the viewer is in the event's zone this is a clean rectangle; otherwise cells that do
 * not exist on a given local day are null.
 */
export function buildGridModel(event: GridEvent, viewerTimeZone: string): GridModel {
  const slots = buildSlots({
    windowStart: event.window_start,
    windowEnd: event.window_end,
    dayStartMinute: event.day_start_minute,
    dayEndMinute: event.day_end_minute,
    slotMinutes: event.slot_minutes,
    timeZone: event.timezone,
  })

  // Columns are the poll's own days (in the event zone) so an evening never splits across two
  // columns; rows are wall times in the viewer's zone, starting from the first slot's time.
  const located = slots.map((slot) => {
    const date = new Date(slot)
    return {
      slot,
      eventDay: zonedParts(date, event.timezone).day,
      ...zonedParts(date, viewerTimeZone),
    }
  })
  const anchor = located[0]?.minute ?? 0
  const order = (minute: number) => (minute - anchor + 1440) % 1440
  const dayKeys = [...new Set(located.map((l) => l.eventDay))].sort()
  const minutes = [...new Set(located.map((l) => l.minute))].sort((a, b) => order(a) - order(b))
  const col = new Map(dayKeys.map((d, i) => [d, i]))
  const row = new Map(minutes.map((m, i) => [m, i]))
  const labelDay = new Map<string, string>()

  const cells: (string | null)[][] = minutes.map(() => dayKeys.map(() => null))
  const index = new Map<string, { row: number; col: number }>()
  for (const l of located) {
    const r = row.get(l.minute)!
    const c = col.get(l.eventDay)!
    if (!labelDay.has(l.eventDay)) labelDay.set(l.eventDay, l.day)
    // Fall back: two slots on the same local wall time keep the first one.
    if (cells[r]![c]) continue
    cells[r]![c] = l.slot
    index.set(l.slot, { row: r, col: c })
  }

  return {
    days: dayKeys.map((eventDay) => {
      const key = labelDay.get(eventDay)!
      return { key, date: new Date(`${key}T12:00:00Z`) }
    }),
    rows: minutes.map((minute) => ({ minute })),
    cells,
    slots: slots.filter((s) => index.has(s)),
    index,
    slotMinutes: event.slot_minutes,
    timeZone: viewerTimeZone,
  }
}

/** Slots that overlap any busy block. */
export function busySlots(
  slots: readonly string[],
  slotMinutes: number,
  blocks: readonly { starts_at: string; ends_at: string }[],
): Set<string> {
  const out = new Set<string>()
  if (blocks.length === 0) return out
  const ranges = blocks.map((b) => [
    Date.parse(slotKey(b.starts_at)),
    Date.parse(slotKey(b.ends_at)),
  ])
  const length = slotMinutes * 60_000
  for (const slot of slots) {
    const start = Date.parse(slot)
    const end = start + length
    if (ranges.some(([from, to]) => from! < end && to! > start)) out.add(slot)
  }
  return out
}

/** Every slot in the rectangle between two cells (inclusive). */
export function slotsInRect(
  model: GridModel,
  a: { row: number; col: number },
  b: { row: number; col: number },
): string[] {
  const out: string[] = []
  const [r0, r1] = a.row <= b.row ? [a.row, b.row] : [b.row, a.row]
  const [c0, c1] = a.col <= b.col ? [a.col, b.col] : [b.col, a.col]
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const slot = model.cells[r]?.[c]
      if (slot) out.push(slot)
    }
  }
  return out
}

/** Next real cell from (row, col) moving by (dr, dc), skipping holes. Null at the edge. */
export function step(
  model: GridModel,
  from: { row: number; col: number },
  dr: number,
  dc: number,
): { row: number; col: number } | null {
  let row = from.row + dr
  let col = from.col + dc
  while (row >= 0 && row < model.rows.length && col >= 0 && col < model.days.length) {
    if (model.cells[row]![col]) return { row, col }
    row += dr
    col += dc
  }
  return null
}
