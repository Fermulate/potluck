import { describe, expect, it } from 'vitest'
import { eventCreateSchema } from '../index'

const GROUP = 'a8f5f167-f44f-4964-b6c2-3b9f1e2d7c4a'
const valid = {
  group_id: GROUP,
  title: ' Taco night ',
  window_start: '2026-06-10',
  window_end: '2026-06-14',
}

const messages = (patch: Record<string, unknown>) =>
  eventCreateSchema.safeParse({ ...valid, ...patch }).error?.issues.map((i) => i.message) ?? []

describe('eventCreateSchema', () => {
  it('fills in the same defaults as the events table', () => {
    expect(eventCreateSchema.parse(valid)).toEqual({
      group_id: GROUP,
      title: 'Taco night',
      description: null,
      location: null,
      emoji: null,
      window_start: '2026-06-10',
      window_end: '2026-06-14',
      day_start_minute: 480,
      day_end_minute: 1320,
      slot_minutes: 30,
      duration_minutes: 120,
      min_attendees: 2,
      rsvp_deadline: null,
    })
  })

  it('accepts a fully specified event', () => {
    const parsed = eventCreateSchema.parse({
      ...valid,
      description: 'bring salsa',
      location: "Sam's place",
      emoji: '🌮',
      day_start_minute: 1020,
      day_end_minute: 1440,
      slot_minutes: 60,
      duration_minutes: 180,
      min_attendees: 4,
      rsvp_deadline: '2026-06-09T12:00:00Z',
    })
    expect(parsed).toMatchObject({
      emoji: '🌮',
      slot_minutes: 60,
      rsvp_deadline: '2026-06-09T12:00:00Z',
    })
  })

  it('allows a single day window', () => {
    expect(eventCreateSchema.safeParse({ ...valid, window_end: valid.window_start }).success).toBe(
      true,
    )
  })

  it('rejects a window that ends before it starts', () => {
    expect(messages({ window_end: '2026-06-09' })).toEqual(['window_end_before_start'])
  })

  it('caps the polling window at 62 days', () => {
    expect(messages({ window_end: '2026-08-10' })).toEqual([])
    expect(messages({ window_end: '2026-08-11' })).toEqual(['window_too_long'])
  })

  it('rejects a day that ends before it starts', () => {
    expect(messages({ day_start_minute: 600, day_end_minute: 600 })).toEqual([
      'day_end_before_start',
    ])
  })

  it('rejects a duration longer than the daily window', () => {
    expect(
      messages({ day_start_minute: 1080, day_end_minute: 1200, duration_minutes: 180 }),
    ).toEqual(['duration_too_long'])
  })

  it.each([
    ['empty title', { title: '  ' }],
    ['odd slot size', { slot_minutes: 20 }],
    ['day past midnight', { day_end_minute: 1441 }],
    ['zero attendees', { min_attendees: 0 }],
    ['zero duration', { duration_minutes: 0 }],
    ['bad date', { window_start: 'June 10' }],
  ])('rejects %s', (_label, patch) => {
    expect(eventCreateSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
  })
})
