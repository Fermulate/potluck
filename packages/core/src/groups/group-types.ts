/**
 * Group types, stored as `groups.type` (the `group_type` enum). Mostly a label, as in
 * Splitwise, with a few defaults: trips can carry dates, homes suggest the monthly bills.
 * Labels live in `@potluck/i18n` under `groups.types.<id>`.
 */
export const GROUP_TYPES = ['home', 'trip', 'couple', 'other'] as const

export type GroupType = (typeof GROUP_TYPES)[number]

const EMOJI: Record<GroupType, string> = {
  home: '🏠',
  trip: '🧳',
  couple: '💞',
  other: '✨',
}

export function isGroupType(value: unknown): value is GroupType {
  return typeof value === 'string' && (GROUP_TYPES as readonly string[]).includes(value)
}

/** Emoji for a stored type; unknown or missing values read as `other`. */
export function groupTypeEmoji(type: string | null | undefined): string {
  return EMOJI[isGroupType(type) ? type : 'other']
}

/** Only trips keep dates. */
export function typeHasDates(type: string | null | undefined): boolean {
  return type === 'trip'
}

export type TripDatesProblem = 'end_before_start' | null

/**
 * Same rule as the `groups_trip_dates_check` constraint: either date may be missing, and when
 * both are there the trip ends on or after the day it starts. Dates are `YYYY-MM-DD`.
 */
export function checkTripDates(
  startsOn: string | null | undefined,
  endsOn: string | null | undefined,
): TripDatesProblem {
  if (startsOn && endsOn && endsOn < startsOn) return 'end_before_start'
  return null
}

/** Bills a new home group is offered, as category ids (`rent`, `utilities`). */
export const HOME_STARTERS = ['rent', 'utilities'] as const

export type HomeStarter = (typeof HOME_STARTERS)[number]

/** Days a deleted group can be restored before the nightly purge removes it. */
export const GROUP_RESTORE_DAYS = 30

/**
 * Days left to restore a group deleted at `deletedAt`, counting a started day as a whole one:
 * 30 right after deleting, 1 on the last day, 0 once the purge may remove it.
 */
export function daysLeftToRestore(deletedAt: string, now: Date = new Date()): number {
  const purge = Date.parse(deletedAt) + GROUP_RESTORE_DAYS * 24 * 60 * 60 * 1000
  return Math.max(0, Math.ceil((purge - now.getTime()) / (24 * 60 * 60 * 1000)))
}
