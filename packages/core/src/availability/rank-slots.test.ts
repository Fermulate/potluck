import { describe, expect, it } from 'vitest'
import { rankSlots, type AvailabilityRow } from '../index'

const at = (time: string) => `2026-06-12T${time}:00.000Z`
const row = (userId: string, time: string, level: 'yes' | 'maybe' = 'yes'): AvailabilityRow => ({
  userId,
  slotStart: at(time),
  level,
})

const options = {
  durationMinutes: 60,
  slotMinutes: 30,
  minAttendees: 2,
  members: ['a', 'b', 'c'],
}

describe('rankSlots', () => {
  const rows = [
    row('a', '18:00'),
    row('a', '18:30'),
    row('a', '19:00'),
    row('b', '18:00'),
    row('b', '18:30', 'maybe'),
    row('c', '18:30', 'maybe'),
    row('c', '19:00', 'maybe'),
  ]

  it('counts a person only if they are free for the whole duration', () => {
    expect(rankSlots(rows, options)).toEqual([
      {
        startsAt: at('18:00'),
        endsAt: at('19:00'),
        yesCount: 1,
        maybeCount: 1,
        score: 1.5,
        missing: ['c'],
      },
      {
        startsAt: at('18:30'),
        endsAt: at('19:30'),
        yesCount: 1,
        maybeCount: 1,
        score: 1.5,
        missing: ['b'],
      },
    ])
  })

  it('orders by score, then earliest start', () => {
    const ranked = rankSlots(
      [...rows, row('a', '19:30'), row('b', '19:00'), row('b', '19:30'), row('c', '19:30')],
      options,
    )
    expect(ranked.map((s) => [s.startsAt, s.score])).toEqual([
      [at('19:00'), 2.5],
      [at('18:30'), 2],
      [at('18:00'), 1.5],
    ])
  })

  it('drops slots below the minimum attendance', () => {
    expect(rankSlots(rows, { ...options, minAttendees: 3 })).toEqual([])
  })

  it('returns at most `limit` slots, five by default', () => {
    const many = Array.from({ length: 8 }, (_, i) => [
      row('a', `${10 + i}:00`),
      row('b', `${10 + i}:00`),
    ]).flat()
    const single = { ...options, durationMinutes: 30 }
    expect(rankSlots(many, single)).toHaveLength(5)
    expect(rankSlots(many, { ...single, limit: 2 })).toHaveLength(2)
  })

  it('ignores rows from people who are no longer members', () => {
    const ranked = rankSlots([row('a', '18:00'), row('zed', '18:00')], {
      ...options,
      durationMinutes: 30,
      minAttendees: 1,
    })
    expect(ranked).toEqual([
      {
        startsAt: at('18:00'),
        endsAt: at('18:30'),
        yesCount: 1,
        maybeCount: 0,
        score: 1,
        missing: ['b', 'c'],
      },
    ])
  })

  it('accepts Date objects and Postgres style timestamps', () => {
    const ranked = rankSlots(
      [
        { userId: 'a', slotStart: new Date(at('18:00')), level: 'yes' },
        { userId: 'b', slotStart: '2026-06-12 18:00:00+00', level: 'yes' },
        { userId: 'c', slotStart: '2026-06-12T20:00:00+02:00', level: 'maybe' },
      ],
      { ...options, durationMinutes: 30 },
    )
    expect(ranked).toEqual([
      {
        startsAt: at('18:00'),
        endsAt: at('18:30'),
        yesCount: 2,
        maybeCount: 1,
        score: 2.5,
        missing: [],
      },
    ])
  })

  it('throws on unreadable timestamps and bad slot sizes', () => {
    expect(() => rankSlots([{ userId: 'a', slotStart: 'soon', level: 'yes' }], options)).toThrow(
      RangeError,
    )
    expect(() => rankSlots([], { ...options, slotMinutes: 0 })).toThrow(RangeError)
  })

  it('rounds a duration that is not a whole number of slots up to the next slot', () => {
    const ranked = rankSlots([row('a', '18:00'), row('b', '18:00'), row('b', '18:30')], {
      ...options,
      durationMinutes: 45,
      minAttendees: 1,
    })
    expect(ranked[0]).toMatchObject({ startsAt: at('18:00'), endsAt: at('18:45'), yesCount: 1 })
  })
})
