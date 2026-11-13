import { addDays, daysInMonth, formatDateOnly, parseDateOnly } from '../internal/date-only'

/** Matches the `recurrence` enum. */
export type Recurrence = 'weekly' | 'biweekly' | 'monthly' | 'yearly'

/** Every interval, shortest first, in the order pickers list them. */
export const RECURRENCES: readonly Recurrence[] = ['weekly', 'biweekly', 'monthly', 'yearly']

export interface RecurrenceOptions {
  /**
   * Day of month the series repeats on. Pass it so a series that started on the 31st goes
   * Jan 31, Feb 28, Mar 31 instead of drifting to the 28th. Defaults to the day of `date`.
   */
  anchorDay?: number
}

/**
 * Next run date after `date` (`YYYY-MM-DD`). Weekly adds 7 days, biweekly 14. Monthly and yearly
 * runs that land past the end of a month clamp to its last day (Jan 31 -> Feb 28, or Feb 29 in
 * leap years). Same rule as `private.recurring_step`.
 */
export function nextOccurrence(
  date: string,
  recurrence: Recurrence,
  options: RecurrenceOptions = {},
): string {
  const current = parseDateOnly(date)
  if (recurrence === 'weekly') return formatDateOnly(addDays(current, 7))
  if (recurrence === 'biweekly') return formatDateOnly(addDays(current, 14))

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

/**
 * The first occurrence after `start` that is on or after `notBefore`: where a series that
 * started on `start` picks up today without back-charging missed periods. Making an expense
 * from last week repeat monthly gives a month after its date; one from three months ago gives
 * the next date still to come. Same rule as `private.recurring_next_from`.
 */
export function firstOccurrenceFrom(
  start: string,
  recurrence: Recurrence,
  notBefore: string,
  options: RecurrenceOptions = {},
): string {
  const anchorDay = options.anchorDay ?? parseDateOnly(start).day
  const floor = formatDateOnly(parseDateOnly(notBefore))
  let next = nextOccurrence(start, recurrence, { anchorDay })
  // `YYYY-MM-DD` strings compare in date order.
  while (next < floor) next = nextOccurrence(next, recurrence, { anchorDay })
  return next
}
