import { describe, expect, it } from 'vitest'
import { buildSlots } from '../index'

describe('buildSlots', () => {
  it('lists every slot start in the daily window, for each day', () => {
    expect(
      buildSlots({
        windowStart: '2026-03-01',
        windowEnd: '2026-03-02',
        dayStartMinute: 480,
        dayEndMinute: 600,
        slotMinutes: 30,
        timeZone: 'UTC',
      }),
    ).toEqual([
      '2026-03-01T08:00:00.000Z',
      '2026-03-01T08:30:00.000Z',
      '2026-03-01T09:00:00.000Z',
      '2026-03-01T09:30:00.000Z',
      '2026-03-02T08:00:00.000Z',
      '2026-03-02T08:30:00.000Z',
      '2026-03-02T09:00:00.000Z',
      '2026-03-02T09:30:00.000Z',
    ])
  })

  it('converts local wall time in the event time zone to UTC', () => {
    expect(
      buildSlots({
        windowStart: '2026-01-15',
        windowEnd: '2026-01-15',
        dayStartMinute: 1080,
        dayEndMinute: 1200,
        slotMinutes: 60,
        timeZone: 'America/New_York',
      }),
    ).toEqual(['2026-01-15T23:00:00.000Z', '2026-01-16T00:00:00.000Z'])
  })

  it('only includes slots that end by the end of the day', () => {
    expect(
      buildSlots({
        windowStart: '2026-03-01',
        windowEnd: '2026-03-01',
        dayStartMinute: 480,
        dayEndMinute: 600,
        slotMinutes: 45,
        timeZone: 'UTC',
      }),
    ).toEqual(['2026-03-01T08:00:00.000Z', '2026-03-01T08:45:00.000Z'])
  })

  it('skips wall times that do not exist when clocks spring forward', () => {
    // 2026-03-08 in New York: 02:00 local jumps to 03:00
    expect(
      buildSlots({
        windowStart: '2026-03-08',
        windowEnd: '2026-03-08',
        dayStartMinute: 60,
        dayEndMinute: 240,
        slotMinutes: 60,
        timeZone: 'America/New_York',
      }),
    ).toEqual(['2026-03-08T06:00:00.000Z', '2026-03-08T07:00:00.000Z'])
  })

  it('uses the first occurrence of repeated wall times when clocks fall back', () => {
    // 2026-11-01 in New York: 01:00 to 02:00 local happens twice
    expect(
      buildSlots({
        windowStart: '2026-11-01',
        windowEnd: '2026-11-01',
        dayStartMinute: 0,
        dayEndMinute: 180,
        slotMinutes: 60,
        timeZone: 'America/New_York',
      }),
    ).toEqual(['2026-11-01T04:00:00.000Z', '2026-11-01T05:00:00.000Z', '2026-11-01T07:00:00.000Z'])
  })

  it('keeps the same local hours across a DST change', () => {
    const slots = buildSlots({
      windowStart: '2026-10-24',
      windowEnd: '2026-10-26',
      dayStartMinute: 1140,
      dayEndMinute: 1200,
      slotMinutes: 60,
      timeZone: 'Europe/London',
    })
    // 19:00 BST is 18:00Z; after the 25th change 19:00 GMT is 19:00Z
    expect(slots).toEqual([
      '2026-10-24T18:00:00.000Z',
      '2026-10-25T19:00:00.000Z',
      '2026-10-26T19:00:00.000Z',
    ])
  })

  it('returns no slots for an empty or inverted window', () => {
    const base = { dayStartMinute: 480, dayEndMinute: 600, slotMinutes: 30, timeZone: 'UTC' }
    expect(buildSlots({ ...base, windowStart: '2026-03-02', windowEnd: '2026-03-01' })).toEqual([])
    expect(
      buildSlots({
        ...base,
        windowStart: '2026-03-01',
        windowEnd: '2026-03-01',
        dayEndMinute: 480,
      }),
    ).toEqual([])
  })

  it('crosses month and year boundaries', () => {
    expect(
      buildSlots({
        windowStart: '2026-12-31',
        windowEnd: '2027-01-01',
        dayStartMinute: 0,
        dayEndMinute: 60,
        slotMinutes: 60,
        timeZone: 'UTC',
      }),
    ).toEqual(['2026-12-31T00:00:00.000Z', '2027-01-01T00:00:00.000Z'])
  })

  it('throws on a non-positive slot length', () => {
    expect(() =>
      buildSlots({
        windowStart: '2026-03-01',
        windowEnd: '2026-03-01',
        dayStartMinute: 0,
        dayEndMinute: 60,
        slotMinutes: 0,
        timeZone: 'UTC',
      }),
    ).toThrow(RangeError)
  })
})
