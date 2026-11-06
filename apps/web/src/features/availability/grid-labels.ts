import { DEFAULT_LOCALE, formatTime, t } from '@potluck/i18n'
import type { GridModel } from './grid'

export const weekday = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  weekday: 'short',
  timeZone: 'UTC',
})
export const dayNum = new Intl.DateTimeFormat(DEFAULT_LOCALE, { day: 'numeric', timeZone: 'UTC' })
export const month = new Intl.DateTimeFormat(DEFAULT_LOCALE, { month: 'short', timeZone: 'UTC' })
export const fullDay = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
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
    format = new Intl.DateTimeFormat(DEFAULT_LOCALE, { ...options, timeZone })
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
  const slot = model.rows[row]?.slot
  return slot ? formatTime(slot, { timeZone: model.timeZone }) : null
}

/** Compact hour label for the row axis: "10 AM" (or "10" on a 24 hour clock). */
export function rowHour(model: GridModel, row: number): string | null {
  const slot = model.rows[row]?.slot
  if (!slot) return null
  const f = zonedFormat(model.timeZone, { hour: 'numeric' })
  return f.format(new Date(slot)).replace(/\s+/g, ' ')
}

export interface AxisLabel {
  /** Full time for screen readers ("10:30 AM"). */
  time: string
  /** What the axis shows, or null for rows that sit inside an already labelled hour. */
  visible: string | null
}

/**
 * Row axis labels: the first row of every viewer hour gets one, as the bare hour when it starts
 * on the hour and as the full time otherwise (a 60 minute poll seen from a half hour zone has
 * no row on the hour at all).
 */
export function axisLabels(model: GridModel): AxisLabel[] {
  return model.rows.map((row, r) => {
    const time = rowTime(model, r) ?? ''
    const prev = model.rows[r - 1]
    const first = !prev || Math.floor(prev.minute / 60) !== Math.floor(row.minute / 60)
    if (!first) return { time, visible: null }
    return { time, visible: row.minute % 60 === 0 ? (rowHour(model, r) ?? time) : time }
  })
}

/** "1 hour later" for a day whose cells sit `shift` minutes off their row labels. */
export function shiftName(shift: number): string | null {
  if (shift === 0) return null
  const minutes = Math.abs(shift)
  const amount =
    minutes % 60 === 0
      ? t('availability.shift.hours', { count: minutes / 60 })
      : t('availability.shift.minutes', { count: minutes })
  return shift > 0
    ? t('availability.shift.later', { amount })
    : t('availability.shift.earlier', { amount })
}

/** "+1 h" under a shifted day's header. */
export function shiftShort(shift: number): string | null {
  if (shift === 0) return null
  const minutes = Math.abs(shift)
  const amount =
    minutes % 60 === 0
      ? t('availability.shift.hoursShort', { count: minutes / 60 })
      : t('availability.shift.minutesShort', { count: minutes })
  return shift > 0
    ? t('availability.shift.laterShort', { amount })
    : t('availability.shift.earlierShort', { amount })
}
