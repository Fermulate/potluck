import { describe, expect, it } from 'vitest'
import { dayLabel, groupByDay } from './days'

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
