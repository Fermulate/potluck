import { formatTime } from '@potluck/i18n'
import type { GridModel } from './grid'

export const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' })
export const dayNum = new Intl.DateTimeFormat(undefined, { day: 'numeric', timeZone: 'UTC' })
export const month = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' })
export const fullDay = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
})

/** "Friday, June 12, 7:30 PM" for a cell's accessible name. */
export function cellName(model: GridModel, slot: string): string {
  const pos = model.index.get(slot)
  const day = pos ? model.days[pos.col] : undefined
  const time = formatTime(slot, { timeZone: model.timeZone })
  return day ? `${fullDay.format(day.date)}, ${time}` : time
}

export function rowTime(model: GridModel, row: number): string | null {
  const slot = model.cells[row]?.find((s) => s)
  return slot ? formatTime(slot, { timeZone: model.timeZone }) : null
}

const hourFormats = new Map<string, Intl.DateTimeFormat>()

/** Compact hour label for the row axis: "10 AM" (or "10" on a 24 hour clock). */
export function rowHour(model: GridModel, row: number): string | null {
  const slot = model.cells[row]?.find((s) => s)
  if (!slot) return null
  let f = hourFormats.get(model.timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: model.timeZone })
    hourFormats.set(model.timeZone, f)
  }
  return f.format(new Date(slot)).replace(/[  ]/g, ' ')
}
