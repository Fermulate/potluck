import { describe, expect, it } from 'vitest'
import { nextOccurrence } from '../index'

describe('nextOccurrence', () => {
  it('adds a week', () => {
    expect(nextOccurrence('2026-01-01', 'weekly')).toBe('2026-01-08')
    expect(nextOccurrence('2026-12-29', 'weekly')).toBe('2027-01-05')
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
  })
})
