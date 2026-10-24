import { useState } from 'react'

const HOUR = 3_600_000

/**
 * The upcoming window the timeline screens share (top of the current hour to `days` ahead).
 * Rounded so every screen reuses the same cached query.
 */
export function useTimelineRange(days = 60) {
  const [range] = useState(() => timelineRange(days))
  return range
}

/** The same window as a plain value, for route loaders. */
export function timelineRange(days = 60) {
  const from = Math.floor(Date.now() / HOUR) * HOUR
  return {
    from: new Date(from).toISOString(),
    to: new Date(from + days * 24 * HOUR).toISOString(),
  }
}
