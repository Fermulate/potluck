import { describe, expect, it } from 'vitest'
import { dayKey, dayLabel, groupByDay } from './days'

describe('dayKey', () => {
  it('uses the local calendar day in the zone', () => {
    expect(dayKey('2026-06-13T02:00:00Z', 'America/Los_Angeles')).toBe('2026-06-12')
    expect(dayKey('2026-06-13T02:00:00Z', 'Europe/Paris')).toBe('2026-06-13')
  })
})

describe('dayLabel', () => {
  it('says today, tomorrow, a weekday this week, else a short date', () => {
    expect(dayLabel('2026-06-12', '2026-06-12')).toBe('Today')
    expect(dayLabel('2026-06-13', '2026-06-12')).toBe('Tomorrow')
    expect(dayLabel('2026-06-15', '2026-06-12')).toBe('Monday')
    expect(dayLabel('2026-06-25', '2026-06-12')).toBe('Thu, Jun 25')
  })
})

describe('groupByDay', () => {
  it('buckets by local day in ascending order', () => {
    const items = [
      { id: 'c', at: '2026-06-20T18:00:00Z' },
      { id: 'a', at: '2026-06-12T18:00:00Z' },
      { id: 'b', at: '2026-06-13T03:00:00Z' },
    ]
    const groups = groupByDay(items, (i) => i.at, {
      timeZone: 'America/Los_Angeles',
      now: Date.parse('2026-06-12T17:00:00Z'),
    })
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Sat, Jun 20', ['c']],
    ])
  })
})
