import type { DateInput } from './dates'
import { t } from './translate'

const hourFormats = new Map<string, Intl.DateTimeFormat>()

function localHour(now: Date, timeZone: string): number {
  let format = hourFormats.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' })
    hourFormats.set(timeZone, format)
  }
  return Number(format.format(now))
}

/** "Morning, Sam." Picks the greeting for the local hour: 5-12 morning, 12-17, 17-22, else night. */
export function greeting(name: string, options: { timeZone: string; now?: DateInput }): string {
  const now = options.now === undefined ? new Date() : new Date(options.now)
  const hour = localHour(now, options.timeZone)
  if (hour >= 5 && hour < 12) return t('home.greeting.morning', { name })
  if (hour >= 12 && hour < 17) return t('home.greeting.afternoon', { name })
  if (hour >= 17 && hour < 22) return t('home.greeting.evening', { name })
  return t('home.greeting.night', { name })
}
