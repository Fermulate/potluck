import { describe, expect, it } from 'vitest'
import { buildGridModel } from './grid'
import { cellName } from './grid-labels'

const event = {
  window_start: '2026-06-12',
  window_end: '2026-06-13',
  day_start_minute: 18 * 60,
  day_end_minute: 20 * 60,
  slot_minutes: 30,
  timezone: 'America/New_York',
}

describe('cellName', () => {
  it('names a cell by its own day and time in the viewer zone', () => {
    const model = buildGridModel(event, 'America/New_York')
    expect(cellName(model, '2026-06-12T22:00:00.000Z')).toBe('Friday, June 12, 6:00 PM')
  })

  it('uses the local date once an evening rolls past midnight, not the column day', () => {
    // 19:00 New York on Saturday June 13 is 00:00 BST on Sunday June 14, in the June 13 column.
    const model = buildGridModel(event, 'Europe/London')
    expect(model.index.get('2026-06-13T23:00:00.000Z')?.col).toBe(1)
    expect(model.days[1]!.key).toBe('2026-06-13')
    expect(cellName(model, '2026-06-13T23:00:00.000Z')).toBe('Sunday, June 14, 12:00 AM')
  })
})
