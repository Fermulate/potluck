import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { RECURRENCES, firstOccurrenceFrom, nextOccurrence } from '../index'

// The same cases run against private.recurring_step and private.recurring_next_from in
// supabase/tests/24_recurring_editing.test.sql.

describe('nextOccurrence', () => {
  it('adds a week', () => {
    expect(nextOccurrence('2026-01-01', 'weekly')).toBe('2026-01-08')
    expect(nextOccurrence('2026-12-29', 'weekly')).toBe('2027-01-05')
  })

  it('adds two weeks for every other week', () => {
    expect(nextOccurrence('2026-01-01', 'biweekly')).toBe('2026-01-15')
    expect(nextOccurrence('2026-12-25', 'biweekly')).toBe('2027-01-08')
    expect(nextOccurrence('2028-02-20', 'biweekly')).toBe('2028-03-05')
  })

  it('adds a month on the same day', () => {
    expect(nextOccurrence('2026-01-15', 'monthly')).toBe('2026-02-15')
    expect(nextOccurrence('2026-12-31', 'monthly')).toBe('2027-01-31')
  })

  it('clamps to the last day of shorter months', () => {
    expect(nextOccurrence('2026-01-31', 'monthly')).toBe('2026-02-28')
    expect(nextOccurrence('2028-01-31', 'monthly')).toBe('2028-02-29')
    expect(nextOccurrence('2026-03-31', 'monthly')).toBe('2026-04-30')
  })

  it('returns to the anchor day after a short month', () => {
    expect(nextOccurrence('2026-02-28', 'monthly', { anchorDay: 31 })).toBe('2026-03-31')
    expect(nextOccurrence('2026-02-28', 'monthly', { anchorDay: 30 })).toBe('2026-03-30')
  })

  it('adds a year, moving Feb 29 to Feb 28 in common years', () => {
    expect(nextOccurrence('2026-07-04', 'yearly')).toBe('2027-07-04')
    expect(nextOccurrence('2028-02-29', 'yearly')).toBe('2029-02-28')
    expect(nextOccurrence('2031-02-28', 'yearly', { anchorDay: 29 })).toBe('2032-02-29')
  })

  it('rejects malformed dates', () => {
    expect(() => nextOccurrence('2026-02-30', 'monthly')).toThrow(RangeError)
    expect(() => nextOccurrence('next tuesday', 'weekly')).toThrow(RangeError)
    expect(() => nextOccurrence('2026-13-01', 'yearly')).toThrow(RangeError)
    expect(() => nextOccurrence('2026-01-00', 'yearly')).toThrow(RangeError)
  })

  it('every 2 weeks is two weekly steps, and always lands on the same weekday', () => {
    const day = fc
      .date({ min: new Date('2000-01-01'), max: new Date('2099-12-31'), noInvalidDate: true })
      .map((d) => d.toISOString().slice(0, 10))
    fc.assert(
      fc.property(day, (start) => {
        const twice = nextOccurrence(nextOccurrence(start, 'weekly'), 'weekly')
        expect(nextOccurrence(start, 'biweekly')).toBe(twice)
        const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay()
        expect(weekday(twice)).toBe(weekday(start))
      }),
    )
  })

  it('lists the intervals shortest first', () => {
    expect(RECURRENCES).toEqual(['weekly', 'biweekly', 'monthly', 'yearly'])
  })
})

describe('firstOccurrenceFrom', () => {
  it('is one period after a recent start', () => {
    expect(firstOccurrenceFrom('2026-11-10', 'monthly', '2026-11-13')).toBe('2026-12-10')
    expect(firstOccurrenceFrom('2026-11-10', 'weekly', '2026-11-13')).toBe('2026-11-17')
    expect(firstOccurrenceFrom('2026-11-10', 'biweekly', '2026-11-13')).toBe('2026-11-24')
    expect(firstOccurrenceFrom('2026-11-10', 'yearly', '2026-11-13')).toBe('2027-11-10')
  })

  it('skips periods that are already past instead of back-charging them', () => {
    expect(firstOccurrenceFrom('2026-08-01', 'monthly', '2026-11-13')).toBe('2026-12-01')
    expect(firstOccurrenceFrom('2026-10-01', 'biweekly', '2026-11-13')).toBe('2026-11-26')
    expect(firstOccurrenceFrom('2026-09-01', 'weekly', '2026-11-13')).toBe('2026-11-17')
  })

  it('keeps a date that falls on the floor itself', () => {
    expect(firstOccurrenceFrom('2026-10-13', 'monthly', '2026-11-13')).toBe('2026-11-13')
  })

  it('holds the start day through short months', () => {
    expect(firstOccurrenceFrom('2026-01-31', 'monthly', '2026-02-01')).toBe('2026-02-28')
    expect(firstOccurrenceFrom('2026-01-31', 'monthly', '2026-03-01')).toBe('2026-03-31')
    expect(firstOccurrenceFrom('2026-01-31', 'monthly', '2026-04-05', { anchorDay: 30 })).toBe(
      '2026-04-30',
    )
  })

  it('is never before the floor and never more than one period after it', () => {
    const day = fc
      .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31'), noInvalidDate: true })
      .map((d) => d.toISOString().slice(0, 10))
    fc.assert(
      fc.property(day, day, fc.constantFrom(...RECURRENCES), (start, floor, kind) => {
        const next = firstOccurrenceFrom(start, kind, floor)
        expect(next > start).toBe(true)
        expect(next >= floor).toBe(true)
        // One more period from the floor itself is always far enough.
        const bound = nextOccurrence(floor, kind, { anchorDay: 31 })
        expect(next <= bound || next === nextOccurrence(start, kind)).toBe(true)
      }),
    )
  })
})
