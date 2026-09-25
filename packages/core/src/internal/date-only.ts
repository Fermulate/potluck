/** Calendar dates as `YYYY-MM-DD` strings, like Postgres `date`. No time zones involved. */

export interface DateParts {
  year: number
  month: number // 1-12
  day: number
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseDateOnly(value: string): DateParts {
  const match = DATE_ONLY.exec(value)
  if (!match) throw new RangeError(`expected YYYY-MM-DD, got ${value}`)
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  if (parts.month < 1 || parts.month > 12 || parts.day < 1) {
    throw new RangeError(`invalid date ${value}`)
  }
  if (parts.day > daysInMonth(parts.year, parts.month))
    throw new RangeError(`invalid date ${value}`)
  return parts
}

export function formatDateOnly({ year, month, day }: DateParts): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function addDays(parts: DateParts, days: number): DateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

export function compareDateOnly(a: DateParts, b: DateParts): number {
  return a.year - b.year || a.month - b.month || a.day - b.day
}
