import { describe, expect, it } from 'vitest'
import { buildGridModel, busySlots, slotKey, slotsInRect, step } from './grid'

const event = {
  window_start: '2026-06-12',
  window_end: '2026-06-13',
  day_start_minute: 18 * 60,
  day_end_minute: 20 * 60,
  slot_minutes: 30,
  timezone: 'America/New_York',
}

describe('buildGridModel', () => {
  it('lays slots out as days by times in the viewer zone', () => {
    const model = buildGridModel(event, 'America/New_York')
    expect(model.days.map((d) => d.key)).toEqual(['2026-06-12', '2026-06-13'])
    expect(model.rows.map((r) => r.minute)).toEqual([1080, 1110, 1140, 1170])
    expect(model.cells[0]![0]).toBe('2026-06-12T22:00:00.000Z')
    expect(model.cells[3]![1]).toBe('2026-06-13T23:30:00.000Z')
    expect(model.index.get('2026-06-13T22:00:00.000Z')).toEqual({ row: 0, col: 1 })
  })

  it('shows times in the viewer zone without splitting an evening across columns', () => {
    // 18:00 to 20:00 New York is 23:00 to 01:00 in London.
    const model = buildGridModel(event, 'Europe/London')
    expect(model.days.map((d) => d.key)).toEqual(['2026-06-12', '2026-06-13'])
    expect(model.rows.map((r) => r.minute)).toEqual([1380, 1410, 0, 30])
    expect(model.cells[0]![0]).toBe('2026-06-12T22:00:00.000Z')
    expect(model.cells[3]![1]).toBe('2026-06-13T23:30:00.000Z')
    expect(model.slots).toHaveLength(8)
  })

  it('keeps each poll hour on one row when the viewer zone changes DST mid poll', () => {
    // London leaves DST on Oct 25 2026, New York on Nov 1: 18:00 New York is 23:00 London
    // on Oct 20 but 22:00 London on Oct 26. Both sit on the 18:00 row.
    const model = buildGridModel(
      { ...event, window_start: '2026-10-20', window_end: '2026-10-30' },
      'Europe/London',
    )
    expect(model.rows.map((r) => r.minute)).toEqual([1380, 1410, 0, 30])
    expect(model.index.get('2026-10-20T22:00:00.000Z')).toEqual({ row: 0, col: 0 })
    expect(model.index.get('2026-10-26T22:00:00.000Z')).toEqual({ row: 0, col: 6 })
    expect(model.slots).toHaveLength(11 * 4)
  })

  it('keeps every slot when the viewer clock repeats an hour on fall back night', () => {
    // London falls back at 01:00Z on Oct 25 2026: 20:00 New York is 01:00 BST and 21:00
    // New York is 01:00 GMT, both minute 60 on the viewer clock.
    const model = buildGridModel(
      {
        ...event,
        window_start: '2026-10-24',
        window_end: '2026-10-24',
        day_start_minute: 18 * 60,
        day_end_minute: 22 * 60,
      },
      'Europe/London',
    )
    expect(model.slots).toHaveLength(8)
    expect(model.index.get('2026-10-25T00:00:00.000Z')).toEqual({ row: 4, col: 0 })
    expect(model.index.get('2026-10-25T01:00:00.000Z')).toEqual({ row: 6, col: 0 })
    expect(model.rows[4]!.minute).toBe(60)
    expect(model.rows[6]!.minute).toBe(60)
    expect(model.cells.flat().filter(Boolean)).toHaveLength(8)
  })
})

describe('grid helpers', () => {
  const model = buildGridModel(event, 'America/New_York')

  it('normalizes Postgres timestamps', () => {
    expect(slotKey('2026-06-12 22:00:00+00')).toBe('2026-06-12T22:00:00.000Z')
  })

  it('collects a rectangle in either drag direction', () => {
    expect(slotsInRect(model, { row: 1, col: 1 }, { row: 0, col: 0 })).toEqual([
      '2026-06-12T22:00:00.000Z',
      '2026-06-13T22:00:00.000Z',
      '2026-06-12T22:30:00.000Z',
      '2026-06-13T22:30:00.000Z',
    ])
  })

  it('steps through cells and stops at the edge', () => {
    expect(step(model, { row: 0, col: 0 }, 1, 0)).toEqual({ row: 1, col: 0 })
    expect(step(model, { row: 0, col: 0 }, -1, 0)).toBeNull()
  })

  it('marks slots that overlap busy blocks', () => {
    const busy = busySlots(model.slots, 30, [
      { starts_at: '2026-06-12 22:15:00+00', ends_at: '2026-06-12 22:45:00+00' },
    ])
    expect([...busy]).toEqual(['2026-06-12T22:00:00.000Z', '2026-06-12T22:30:00.000Z'])
  })
})
