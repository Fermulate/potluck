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

const zonedFormats = new Map<string, Intl.DateTimeFormat>()

function zonedFormat(timeZone: string, options: Intl.DateTimeFormatOptions) {
  const key = `${timeZone}|${JSON.stringify(options)}`
  let format = zonedFormats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(undefined, { ...options, timeZone })
    zonedFormats.set(key, format)
  }
  return format
}

/**
 * "Friday, June 12, 7:30 PM" for a cell's accessible name: the slot's own calendar day in the
 * viewer's zone, which can differ from its column once an evening rolls past local midnight.
 */
export function cellName(model: GridModel, slot: string): string {
  const day = zonedFormat(model.timeZone, { weekday: 'long', month: 'long', day: 'numeric' })
  return `${day.format(new Date(slot))}, ${formatTime(slot, { timeZone: model.timeZone })}`
}

export function rowTime(model: GridModel, row: number): string | null {
  const slot = model.cells[row]?.find((s) => s)
  return slot ? formatTime(slot, { timeZone: model.timeZone }) : null
}

/** Compact hour label for the row axis: "10 AM" (or "10" on a 24 hour clock). */
export function rowHour(model: GridModel, row: number): string | null {
  const slot = model.cells[row]?.find((s) => s)
  if (!slot) return null
  const f = zonedFormat(model.timeZone, { hour: 'numeric' })
  return f.format(new Date(slot)).replace(/\s+/g, ' ')
}
