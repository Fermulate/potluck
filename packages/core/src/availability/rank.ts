import { compareIds } from '../money/allocate'

export type AvailabilityLevel = 'yes' | 'maybe'

export interface AvailabilityRow {
  userId: string
  /** A timestamptz from the database (any ISO 8601 / Postgres text form) or a Date. */
  slotStart: string | Date
  level: AvailabilityLevel
}

export interface RankOptions {
  durationMinutes: number
  slotMinutes: number
  /** Minimum yes + maybe attendees for a slot to be suggested. */
  minAttendees: number
  /** Current group members. Rows from anyone else are ignored. */
  members: readonly string[]
  /**
   * Guests who answered through a guest link (their guest ids). They count exactly like
   * members, as `best_slots` does since guest links (ADR 10).
   */
  guests?: readonly string[]
  /** Maximum number of suggestions. Defaults to 5, like `best_slots`. */
  limit?: number
}

/** Same shape as a row of the SQL `best_slots` function. */
export interface RankedSlot {
  startsAt: string
  endsAt: string
  yesCount: number
  maybeCount: number
  /** yes + 0.5 * maybe */
  score: number
  /** Members and guests who cannot make the whole duration, sorted by id. */
  missing: string[]
}

const MINUTE = 60_000

/** Parse a timestamptz in ISO or Postgres text form (`2026-06-12 18:00:00+00`) to epoch ms. */
function toEpoch(value: string | Date): number {
  if (value instanceof Date) return value.getTime()
  const iso = value
    .trim()
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00')
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new RangeError(`invalid timestamp: ${value}`)
  return ms
}

/**
 * Client-side twin of SQL `best_slots`. Every distinct slot start in `rows` is a candidate.
 * A member counts as "yes" if they said yes to every slot the event would cover, as "maybe"
 * if they said yes or maybe to all of them (with at least one maybe), and is "missing"
 * otherwise. Durations that are not a whole number of slots round up to the next slot.
 * Candidates with fewer than `minAttendees` (yes + maybe) are dropped. Ordered by score
 * descending, then earliest start.
 */
export function rankSlots(rows: readonly AvailabilityRow[], options: RankOptions): RankedSlot[] {
  if (!(options.slotMinutes > 0)) throw new RangeError('slotMinutes must be positive')
  const members = [...new Set([...options.members, ...(options.guests ?? [])])].sort(compareIds)
  const memberSet = new Set(members)
  const slotsNeeded = Math.max(1, Math.ceil(options.durationMinutes / options.slotMinutes))
  const step = options.slotMinutes * MINUTE

  // userId -> slot epoch -> level
  const byUser = new Map<string, Map<number, AvailabilityLevel>>()
  const candidates = new Set<number>()
  for (const row of rows) {
    if (!memberSet.has(row.userId)) continue
    const start = toEpoch(row.slotStart)
    candidates.add(start)
    let levels = byUser.get(row.userId)
    if (!levels) byUser.set(row.userId, (levels = new Map()))
    levels.set(start, row.level)
  }

  const ranked: (RankedSlot & { epoch: number })[] = []
  for (const start of candidates) {
    let yesCount = 0
    let maybeCount = 0
    const missing: string[] = []
    for (const member of members) {
      const levels = byUser.get(member)
      let attending: AvailabilityLevel | undefined = 'yes'
      for (let i = 0; i < slotsNeeded && attending; i++) {
        const level = levels?.get(start + i * step)
        if (!level) attending = undefined
        else if (level === 'maybe') attending = 'maybe'
      }
      if (attending === 'yes') yesCount++
      else if (attending === 'maybe') maybeCount++
      else missing.push(member)
    }
    if (yesCount + maybeCount < options.minAttendees) continue
    ranked.push({
      epoch: start,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + options.durationMinutes * MINUTE).toISOString(),
      yesCount,
      maybeCount,
      score: yesCount + 0.5 * maybeCount,
      missing,
    })
  }

  ranked.sort((a, b) => b.score - a.score || a.epoch - b.epoch)
  return ranked.slice(0, options.limit ?? 5).map(({ epoch: _epoch, ...slot }) => slot)
}
