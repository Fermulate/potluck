import { categoryEmoji, isCategory } from '@potluck/core'
import { formatDate, hasMessage, t } from '@potluck/i18n'

/** Label for a stored category, including legacy values outside the core list. */
export function categoryLabel(category: string | null | undefined): string {
  if (!category) return t('categories.other')
  if (isCategory(category)) return t(`categories.${category}`)
  const key = `categories.${category}`
  if (hasMessage(key)) return t(key as 'categories.other')
  return category.charAt(0).toUpperCase() + category.slice(1)
}

export { categoryEmoji }

/** `YYYY-MM-DD` for "now" in `timeZone`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Calendar day of a timestamp in `timeZone`, as `YYYY-MM-DD`. */
export function dayOf(timestamp: string, timeZone: string): string {
  return todayIn(timeZone, new Date(timestamp))
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/** "Today", "Yesterday", "Mon, Nov 3", or "Nov 3, 2025" for older years. */
export function dayLabel(day: string, timeZone: string, now: Date = new Date()): string {
  const today = todayIn(timeZone, now)
  if (day === today) return t('common.today')
  if (day === shiftDay(today, -1)) return t('common.yesterday')
  if (day.slice(0, 4) !== today.slice(0, 4)) return formatDate(day, { timeZone, style: 'medium' })
  return formatDate(day, { timeZone, style: 'weekday' })
}

/** Groups already sorted items into consecutive day sections. */
export function groupByDay<T>(items: readonly T[], dayOfItem: (item: T) => string) {
  const sections: { day: string; items: T[] }[] = []
  for (const item of items) {
    const day = dayOfItem(item)
    const last = sections[sections.length - 1]
    if (last && last.day === day) last.items.push(item)
    else sections.push({ day, items: [item] })
  }
  return sections
}
