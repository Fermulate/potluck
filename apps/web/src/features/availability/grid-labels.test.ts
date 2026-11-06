import { describe, expect, it } from 'vitest'
import { buildGridModel } from './grid'
import { axisLabels, cellName, shiftName, shiftShort } from './grid-labels'

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

describe('axisLabels', () => {
  const visible = (model: ReturnType<typeof buildGridModel>) =>
    axisLabels(model).map((a) => a.visible)

  it('labels each hour once in the event zone', () => {
    expect(visible(buildGridModel(event, 'America/New_York'))).toEqual(['6 PM', null, '7 PM', null])
  })

  it('labels hourly polls seen from a half hour zone with the full time', () => {
    // 18:00 to 21:00 New York is 03:30 to 06:30 in Kolkata: no row starts on the hour.
    const model = buildGridModel(
      { ...event, slot_minutes: 60, day_end_minute: 21 * 60 },
      'Asia/Kolkata',
    )
    expect(visible(model)).toEqual(['3:30 AM', '4:30 AM', '5:30 AM'])
    expect(axisLabels(model).map((a) => a.time)).toEqual(['3:30 AM', '4:30 AM', '5:30 AM'])
  })

  it('labels a half hour start that has no on the hour row above it', () => {
    const model = buildGridModel({ ...event, day_start_minute: 18 * 60 + 30 }, 'America/New_York')
    expect(visible(model)).toEqual(['6:30 PM', '7 PM', null])
  })

  it('labels the shared time after a mid window DST change', () => {
    const model = buildGridModel(
      { ...event, window_start: '2026-10-20', window_end: '2026-10-30' },
      'Europe/London',
    )
    expect(axisLabels(model).map((a) => a.time)).toEqual([
      '10:00 PM',
      '10:30 PM',
      '11:00 PM',
      '11:30 PM',
    ])
  })
})

describe('shift names', () => {
  it('reads nothing for an unshifted day', () => {
    expect(shiftName(0)).toBeNull()
    expect(shiftShort(0)).toBeNull()
  })

  it('names hours and half hours in both directions', () => {
    expect(shiftName(60)).toBe('times run 1 hour later than the row labels')
    expect(shiftShort(60)).toBe('+1 h')
    expect(shiftName(-30)).toBe('times run 30 minutes earlier than the row labels')
    expect(shiftShort(-30)).toBe('-30 min')
  })
})
