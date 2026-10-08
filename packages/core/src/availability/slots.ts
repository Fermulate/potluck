import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { addDays, compareDateOnly, formatDateOnly, parseDateOnly } from '../internal/date-only'

export interface SlotGrid {
  /** First day of the poll, `YYYY-MM-DD` (inclusive). */
  windowStart: string
  /** Last day of the poll, `YYYY-MM-DD` (inclusive). */
  windowEnd: string
  /** Local minutes after midnight when each day's grid starts (480 = 08:00). */
  dayStartMinute: number
  /** Local minutes after midnight when each day's grid ends. A slot must end by this time. */
  dayEndMinute: number
  slotMinutes: number
  /** IANA zone the wall times are in, e.g. `America/New_York`. */
  timeZone: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Every slot start in the poll window as a UTC ISO string, in ascending order.
 *
 * Slots are laid out in local wall time for `timeZone`, so "8pm" stays 8pm across a DST change.
 * Wall times that do not exist (spring forward) are skipped. Wall times that happen twice
 * (fall back) use their first occurrence.
 */
export function buildSlots(grid: SlotGrid): string[] {
  if (!(grid.slotMinutes > 0)) throw new RangeError('slotMinutes must be positive')
  const end = parseDateOnly(grid.windowEnd)
  const slots: string[] = []

  for (let day = parseDateOnly(grid.windowStart); compareDateOnly(day, end) <= 0;) {
    const date = formatDateOnly(day)
    for (
      let minute = grid.dayStartMinute;
      minute + grid.slotMinutes <= grid.dayEndMinute;
      minute += grid.slotMinutes
    ) {
      const wall = `${date}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`
      const instant = fromZonedTime(`${wall}:00`, grid.timeZone)
      if (formatInTimeZone(instant, grid.timeZone, "yyyy-MM-dd'T'HH:mm") !== wall) continue
      slots.push(instant.toISOString())
    }
    day = addDays(day, 1)
  }
  return slots
}
