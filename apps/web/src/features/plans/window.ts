import { formatDuration } from './format'

const DAY = 86_400_000

/** Which days and which hours of each day a poll asks about. Days are `YYYY-MM-DD`. */
export interface PollWindow {
  windowStart: string
  windowEnd: string
  dayStartMinute: number
  dayEndMinute: number
}

export type WindowField = 'window_start' | 'window_end' | 'day_end_minute'

export const addDays = (key: string, n: number) =>
  new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)

/** Days from start to end, both included; 0 when the end is before the start. */
export function windowDays(range: Pick<PollWindow, 'windowStart' | 'windowEnd'>): number {
  return Math.round((Date.parse(range.windowEnd) - Date.parse(range.windowStart)) / DAY) + 1 || 0
}

const DURATIONS = [30, 60, 90, 120, 180, 240, 360, 480, 720]

/** The lengths a plan can last, for a duration `Select`. */
export function durationOptions() {
  return DURATIONS.map((d) => ({ value: String(d), label: formatDuration(d) }))
}
