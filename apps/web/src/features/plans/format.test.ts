import { PlanError } from '@potluck/api'
import { describe, expect, it } from 'vitest'
import { minuteOfDayIn, planErrorMessage } from './format'

describe('planErrorMessage', () => {
  it('explains archived groups and closed RSVPs', () => {
    expect(planErrorMessage(new PlanError('group_archived'))).toBe(
      'This group is archived, so its plans are read only.',
    )
    expect(planErrorMessage(new PlanError('rsvp_closed'))).toBe('RSVPs for this plan are closed.')
  })
})

describe('minuteOfDayIn', () => {
  it('turns a wall minute of a calendar day in a zone into the instant', () => {
    // 6:00 PM New York on June 12 is 22:00 UTC (EDT, UTC-4).
    expect(minuteOfDayIn('2026-06-12', 18 * 60, 'America/New_York').toISOString()).toBe(
      '2026-06-12T22:00:00.000Z',
    )
    // Midnight at the end of the day rolls into the next calendar day.
    expect(minuteOfDayIn('2026-06-12', 1440, 'America/New_York').toISOString()).toBe(
      '2026-06-13T04:00:00.000Z',
    )
  })
})
