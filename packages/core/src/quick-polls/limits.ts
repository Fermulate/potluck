/**
 * Limits for quick polls (ADR 22). The database enforces the same numbers in
 * `public.create_quick_poll` and the `public.quick_polls` checks; change both together.
 */
export const QUICK_POLL_MIN_PEOPLE = 2
export const QUICK_POLL_MAX_PEOPLE = 15
export const QUICK_POLL_DEFAULT_PEOPLE = 10
/** Days a poll's window may cover, first and last day included. */
export const QUICK_POLL_MAX_DAYS = 14
export const QUICK_POLL_TITLE_MAX = 80
export const QUICK_POLL_NAME_MAX = 40
export const QUICK_POLL_TTLS = ['24h', '7d'] as const
export type QuickPollTtl = (typeof QUICK_POLL_TTLS)[number]
export const QUICK_POLL_SLOT_MINUTES = [30, 60] as const
export type QuickPollSlotMinutes = (typeof QUICK_POLL_SLOT_MINUTES)[number]

export function isQuickPollTtl(value: unknown): value is QuickPollTtl {
  return QUICK_POLL_TTLS.some((ttl) => ttl === value)
}

/** True when the days from `windowStart` to `windowEnd` (`YYYY-MM-DD`, both included) fit a poll. */
export function quickPollWindowFits(windowStart: string, windowEnd: string): boolean {
  const days =
    (Date.parse(`${windowEnd}T00:00:00Z`) - Date.parse(`${windowStart}T00:00:00Z`)) / 86_400_000 + 1
  return Number.isInteger(days) && days >= 1 && days <= QUICK_POLL_MAX_DAYS
}
