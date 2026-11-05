import { addDays, daysInMonth, formatDateOnly, parseDateOnly } from '../internal/date-only'

/** Matches the `recurrence` enum. */
export type Recurrence = 'weekly' | 'monthly' | 'yearly'

export interface RecurrenceOptions {
  /**
   * Day of month the series was originally on. Pass it so a series that started on the 31st
   * goes Jan 31, Feb 28, Mar 31 instead of drifting to the 28th. Defaults to the day of `date`.
   */
  anchorDay?: number
}

/**
 * Next run date after `date` (`YYYY-MM-DD`). Monthly and yearly runs that land past the end of a
 * month clamp to its last day (Jan 31 -> Feb 28, or Feb 29 in leap years).
 */
export function nextOccurrence(
  date: string,
  recurrence: Recurrence,
  options: RecurrenceOptions = {},
): string {
  const current = parseDateOnly(date)
  if (recurrence === 'weekly') return formatDateOnly(addDays(current, 7))

  const anchorDay = options.anchorDay ?? current.day
  let { year, month } = current
  if (recurrence === 'monthly') {
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  } else {
    year += 1
  }
  return formatDateOnly({ year, month, day: Math.min(anchorDay, daysInMonth(year, month)) })
}
