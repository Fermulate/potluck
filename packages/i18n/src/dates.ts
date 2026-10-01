import { DEFAULT_LOCALE } from './money'

/** A Date, epoch ms, ISO timestamp, or a `YYYY-MM-DD` calendar date. */
export type DateInput = Date | number | string

export interface DateFormatOptions {
  /** IANA zone to render in, usually `profiles.timezone`. Required: never rely on the host zone. */
  timeZone: string
  locale?: string
}

export type DateStyle = 'short' | 'medium' | 'long' | 'full' | 'weekday' | 'dayMonth'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const isDateOnly = (value: DateInput): value is string =>
  typeof value === 'string' && DATE_ONLY.test(value)

/**
 * Calendar dates (`spent_at`, `window_start`) have no time zone: they are pinned to UTC
 * midnight and always rendered in UTC so June 12 stays June 12 everywhere.
 */
function toDate(value: DateInput): Date {
  if (isDateOnly(value)) return new Date(`${value}T00:00:00Z`)
  return value instanceof Date ? value : new Date(value)
}

const zoneFor = (value: DateInput, timeZone: string) => (isDateOnly(value) ? 'UTC' : timeZone)

/**
 * Normalize ICU output so it is stable across engines: thin and narrow no-break spaces (which
 * ICU uses inconsistently, e.g. before AM/PM) become plain spaces, and range dashes become a
 * spaced hyphen per house style.
 */
const clean = (text: string) =>
  text.replace(/\s*[\u2013\u2014]\s*/g, ' - ').replace(/[\u2009\u202f]/g, ' ')

const cache = new Map<string, Intl.DateTimeFormat>()
function dateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}|${JSON.stringify(options)}`
  let format = cache.get(key)
  if (!format) cache.set(key, (format = new Intl.DateTimeFormat(locale, options)))
  return format
}

const STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { dateStyle: 'short' },
  medium: { dateStyle: 'medium' },
  long: { dateStyle: 'long' },
  full: { dateStyle: 'full' },
  weekday: { weekday: 'short', month: 'short', day: 'numeric' },
  dayMonth: { month: 'short', day: 'numeric' },
}

/** "Jun 12, 2026" by default. */
export function formatDate(
  value: DateInput,
  options: DateFormatOptions & { style?: DateStyle },
): string {
  const format = dateTimeFormat(options.locale ?? DEFAULT_LOCALE, {
    ...STYLES[options.style ?? 'medium'],
    timeZone: zoneFor(value, options.timeZone),
  })
  return clean(format.format(toDate(value)))
}

/** "7:30 PM" (or "19:30" where the locale uses a 24 hour clock). */
export function formatTime(value: DateInput, options: DateFormatOptions): string {
  const format = dateTimeFormat(options.locale ?? DEFAULT_LOCALE, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: options.timeZone,
  })
  return clean(format.format(toDate(value)))
}

/** Calendar fields of an instant in a zone, as a UTC timestamp for easy subtraction. */
function calendarDay(date: Date, timeZone: string): { epoch: number; months: number } {
  const parts = dateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const year = get('year')
  const month = get('month')
  return { epoch: Date.UTC(year, month - 1, get('day')), months: year * 12 + month }
}

/**
 * "now", "5 minutes ago", "in 2 hours", "yesterday", "3 days ago", "2 weeks ago",
 * "next month", "last year". Beyond 22 hours it counts calendar days in `timeZone`,
 * so something from last night reads as "yesterday" even if it was 23 hours ago.
 * Calendar dates (`YYYY-MM-DD`) are compared by day only: "today", "yesterday", "in 3 days".
 */
export function formatRelative(
  value: DateInput,
  options: DateFormatOptions & { now?: DateInput },
): string {
  const rtf = new Intl.RelativeTimeFormat(options.locale ?? DEFAULT_LOCALE, { numeric: 'auto' })
  const nowInput = options.now ?? Date.now()
  const date = toDate(value)
  const now = toDate(nowInput)
  const diff = date.getTime() - now.getTime()
  const abs = Math.abs(diff)
  const timed = !isDateOnly(value)

  if (timed && abs < 45_000) return rtf.format(0, 'second')
  if (timed && abs < 45 * MINUTE) return rtf.format(Math.round(diff / MINUTE), 'minute')

  const a = calendarDay(date, zoneFor(value, options.timeZone))
  const b = calendarDay(now, zoneFor(nowInput, options.timeZone))
  const days = Math.round((a.epoch - b.epoch) / DAY)
  if (timed && (abs < 22 * HOUR || days === 0)) {
    return rtf.format(Math.round(diff / HOUR), 'hour')
  }
  if (Math.abs(days) < 7) return rtf.format(days, 'day')

  const months = a.months - b.months
  if (Math.abs(days) < 28 || months === 0) return rtf.format(Math.round(days / 7), 'week')
  if (Math.abs(months) < 12) return rtf.format(months, 'month')
  return rtf.format(Math.round(months / 12), 'year')
}

/**
 * "Fri, Jun 12, 7:00 - 9:00 PM" for timestamps, "Jun 10 - 14, 2026" for calendar dates.
 * Shared parts are only shown once. Times are included unless both ends are calendar dates
 * or `withTime` is false.
 */
export function formatDateRange(
  start: DateInput,
  end: DateInput,
  options: DateFormatOptions & { withTime?: boolean },
): string {
  const withTime = options.withTime ?? !(isDateOnly(start) && isDateOnly(end))
  const format = dateTimeFormat(options.locale ?? DEFAULT_LOCALE, {
    ...(withTime
      ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric', year: 'numeric' }),
    timeZone: zoneFor(start, options.timeZone),
  })
  return clean(format.formatRange(toDate(start), toDate(end)))
}
