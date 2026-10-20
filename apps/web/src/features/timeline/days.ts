import { formatDate, t } from '@potluck/i18n'

const keyFormats = new Map<string, Intl.DateTimeFormat>()

/** `YYYY-MM-DD` of an instant in a zone. */
export function dayKey(value: string | number | Date, timeZone: string): string {
  let f = keyFormats.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    keyFormats.set(timeZone, f)
  }
  return f.format(new Date(value))
}

const DAY = 86_400_000
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY)

/** "Today", "Tomorrow", "Saturday" (within a week), else "Sat, Nov 21". */
export function dayLabel(key: string, todayKey: string): string {
  const diff = daysBetween(todayKey, key)
  if (diff === 0) return t('timeline.today')
  if (diff === 1) return t('timeline.tomorrow')
  if (diff > 1 && diff < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(
      new Date(`${key}T12:00:00Z`),
    )
  }
  return formatDate(key, { timeZone: 'UTC', style: 'weekday' })
}

export interface DayGroup<T> {
  key: string
  label: string
  items: T[]
}

/** Buckets items by local day (ascending), keeping each day's items in input order. */
export function groupByDay<T>(
  items: readonly T[],
  when: (item: T) => string,
  options: { timeZone: string; now: number },
): DayGroup<T>[] {
  const today = dayKey(options.now, options.timeZone)
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = dayKey(when(item), options.timeZone)
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return [...map.keys()]
    .sort()
    .map((key) => ({ key, label: dayLabel(key, today), items: map.get(key)! }))
}
