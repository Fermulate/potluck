import { describe, expect, it } from 'vitest'
import { dayKey } from '../index'

describe('dayKey', () => {
  it('is the calendar day in the given zone', () => {
    expect(dayKey('2026-06-13T02:00:00Z', 'America/Los_Angeles')).toBe('2026-06-12')
    expect(dayKey('2026-06-13T02:00:00Z', 'Europe/Paris')).toBe('2026-06-13')
    expect(dayKey(Date.UTC(2026, 11, 31, 23, 30), 'Asia/Tokyo')).toBe('2027-01-01')
    expect(dayKey(new Date('2026-03-08T12:00:00Z'), 'UTC')).toBe('2026-03-08')
  })
})
