import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { buildGridModel } from './grid'
import { GridFrame } from './grid-frame'

const event = {
  window_start: '2026-10-23',
  window_end: '2026-10-27',
  day_start_minute: 18 * 60,
  day_end_minute: 19 * 60,
  slot_minutes: 60,
  timezone: 'America/New_York',
}

const frame = (timeZone: string) =>
  render(
    <GridFrame
      model={buildGridModel(event, timeZone)}
      label="Availability"
      renderCell={(slot) => <span role="gridcell">{slot}</span>}
    />,
  )

describe('GridFrame', () => {
  it('shows a row label for hourly polls in a half hour zone', () => {
    frame('Asia/Kolkata')
    expect(screen.getByRole('rowheader')).toHaveTextContent('3:30 AM')
  })

  it('flags the days a DST change moved off the row labels', () => {
    // London falls back on Oct 25: Oct 23 and 24 sit at 23:00 BST, Oct 25 to 27 at 22:00 GMT.
    frame('Europe/London')
    expect(screen.getByRole('rowheader')).toHaveTextContent('10 PM')
    expect(
      screen.getByRole('columnheader', {
        name: 'Friday, October 23, times run 1 hour later than the row labels',
      }),
    ).toHaveTextContent('+1 h')
    expect(screen.getByRole('columnheader', { name: 'Sunday, October 25' })).not.toHaveTextContent(
      '+',
    )
  })
})
