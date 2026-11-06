import { PlanError } from '@potluck/api'
import { formatTime, hasMessage, t } from '@potluck/i18n'
import { fromZonedTime } from 'date-fns-tz'

/** "2 hours", "90 minutes" -> "1 h 30 min". */
export function formatDuration(minutes: number): string {
  if (minutes % 60 === 0) return t('events.durationHours', { count: minutes / 60 })
  if (minutes < 60) return t('events.durationMinutes', { count: minutes })
  return t('events.durationHoursMinutes', {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  })
}

/** Minutes after midnight as a wall clock label ("7:30 PM"), independent of any zone. */
export function formatMinuteOfDay(minute: number): string {
  const day = Math.floor(minute / 1440)
  const m = minute - day * 1440
  const date = new Date(Date.UTC(2000, 0, 1 + day, Math.floor(m / 60), m % 60))
  return formatTime(date, { timeZone: 'UTC' })
}

/** The instant `minute` minutes after local midnight of calendar day `day` in `timeZone`. */
export function minuteOfDayIn(day: string, minute: number, timeZone: string): Date {
  const wall = new Date(`${day}T00:00:00Z`)
  wall.setUTCMinutes(minute)
  return fromZonedTime(wall.toISOString().slice(0, 19), timeZone)
}

/** The server's own error code when it is one the plans RPCs raise on purpose. */
export function planErrorCode(error: unknown): string | null {
  if (!(error instanceof PlanError)) return null
  return hasMessage(`events.errors.${error.code}`) ? error.code : null
}

/** Human message for an error thrown by the plans API. */
export function planErrorMessage(error: unknown): string {
  const code = planErrorCode(error)
  if (code) return (t as (k: string) => string)(`events.errors.${code}`)
  return t('errors.generic')
}

/** "Ava", "Ava and Ben", "Ava, Ben and 2 others". */
export function joinNames(names: string[], max = 2): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]!
  if (names.length <= max) {
    return `${names.slice(0, -1).join(', ')} ${t('common.and')} ${names[names.length - 1]}`
  }
  return t('common.nameAndOthers', {
    name: names.slice(0, max).join(', '),
    count: names.length - max,
  })
}
