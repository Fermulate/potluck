import { typeHasDates } from '@potluck/core'
import { formatDate, t } from '@potluck/i18n'

/** "Jun 3 to Jun 10", "From Jun 3", "Until Jun 10", or null when a trip has no dates. */
export function tripDatesLabel(group: {
  type?: string | null
  starts_on: string | null
  ends_on: string | null
}): string | null {
  if (!typeHasDates(group.type)) return null
  // Calendar dates render pinned to UTC, like spent_at.
  const day = (d: string) => formatDate(d, { timeZone: 'UTC', style: 'dayMonth' })
  if (group.starts_on && group.ends_on) {
    return t('groups.trip.range', { start: day(group.starts_on), end: day(group.ends_on) })
  }
  if (group.starts_on) return t('groups.trip.from', { start: day(group.starts_on) })
  if (group.ends_on) return t('groups.trip.until', { end: day(group.ends_on) })
  return null
}
