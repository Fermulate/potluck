import { describe, expect, it } from 'vitest'
import {
  GROUP_TYPES,
  checkTripDates,
  daysLeftToRestore,
  groupTypeEmoji,
  isGroupType,
  typeHasDates,
} from '../index'

describe('group types', () => {
  it('lists the types in picker order, matching the group_type enum', () => {
    expect(GROUP_TYPES).toEqual(['home', 'trip', 'couple', 'other'])
  })

  it('narrows strings to types', () => {
    expect(isGroupType('trip')).toBe(true)
    expect(isGroupType('Trip')).toBe(false)
    expect(isGroupType(null)).toBe(false)
  })

  it('gives each type an emoji, other for anything else', () => {
    expect(new Set(GROUP_TYPES.map(groupTypeEmoji)).size).toBe(GROUP_TYPES.length)
    expect(groupTypeEmoji('apartment')).toBe(groupTypeEmoji('other'))
    expect(groupTypeEmoji(undefined)).toBe(groupTypeEmoji('other'))
  })

  it('only gives trips dates', () => {
    expect(GROUP_TYPES.filter(typeHasDates)).toEqual(['trip'])
  })
})

describe('checkTripDates', () => {
  it('allows open ended and one day trips, like groups_trip_dates_check', () => {
    expect(checkTripDates(null, null)).toBeNull()
    expect(checkTripDates('2026-06-03', null)).toBeNull()
    expect(checkTripDates(undefined, '2026-06-10')).toBeNull()
    expect(checkTripDates('2026-06-03', '2026-06-03')).toBeNull()
    expect(checkTripDates('2026-06-03', '2026-06-10')).toBeNull()
  })

  it('refuses a trip that ends before it starts', () => {
    expect(checkTripDates('2026-06-10', '2026-06-03')).toBe('end_before_start')
  })
})

describe('daysLeftToRestore', () => {
  const deleted = '2026-11-01T12:00:00Z'

  it('counts down from 30 days, like the purge job, a started day counting whole', () => {
    expect(daysLeftToRestore(deleted, new Date('2026-11-01T12:00:00Z'))).toBe(30)
    expect(daysLeftToRestore(deleted, new Date('2026-11-01T12:05:00Z'))).toBe(30)
    expect(daysLeftToRestore(deleted, new Date('2026-11-02T13:00:00Z'))).toBe(29)
    expect(daysLeftToRestore(deleted, new Date('2026-12-01T11:00:00Z'))).toBe(1)
    expect(daysLeftToRestore(deleted, new Date('2026-12-01T12:00:00Z'))).toBe(0)
  })

  it('never goes below zero', () => {
    expect(daysLeftToRestore(deleted, new Date('2027-01-01T00:00:00Z'))).toBe(0)
  })
})
