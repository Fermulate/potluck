import { describe, expect, it } from 'vitest'
import { greeting } from './index'

describe('greeting', () => {
  const at = (iso: string, timeZone = 'UTC') => greeting('Sam', { now: iso, timeZone })

  it('fits the time of day in the viewer zone', () => {
    expect(at('2026-06-12T08:00:00Z')).toBe('Morning, Sam.')
    expect(at('2026-06-12T13:00:00Z')).toBe('Afternoon, Sam.')
    expect(at('2026-06-12T19:00:00Z')).toBe('Evening, Sam.')
    expect(at('2026-06-12T02:00:00Z')).toBe('Up late, Sam?')
  })

  it('uses local time, not UTC', () => {
    // 13:00 UTC is 9:00 in New York
    expect(at('2026-06-12T13:00:00Z', 'America/New_York')).toBe('Morning, Sam.')
  })

  it('switches at 5am, noon, 5pm and 10pm', () => {
    expect(at('2026-06-12T04:59:00Z')).toBe('Up late, Sam?')
    expect(at('2026-06-12T05:00:00Z')).toBe('Morning, Sam.')
    expect(at('2026-06-12T12:00:00Z')).toBe('Afternoon, Sam.')
    expect(at('2026-06-12T17:00:00Z')).toBe('Evening, Sam.')
    expect(at('2026-06-12T22:00:00Z')).toBe('Up late, Sam?')
  })
})
