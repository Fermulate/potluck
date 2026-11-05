import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DateChip } from './date-chip'

// 02:00 UTC on 1 March is still 28 February in Los Angeles.
const date = new Date('2026-03-01T02:00:00Z')

describe('DateChip', () => {
  it('reads out the full date in the given zone and shows month and day', () => {
    render(<DateChip date={date} locale="en-US" timeZone="America/Los_Angeles" />)
    const chip = screen.getByLabelText('Saturday, February 28, 2026')
    expect(chip.tagName).toBe('TIME')
    expect(chip).toHaveAttribute('dateTime', '2026-03-01T02:00:00.000Z')
    expect(chip).toHaveTextContent(/^Feb28$/)
  })

  it('uses the zone for the visible day too', () => {
    render(<DateChip date={date} locale="en-US" timeZone="Asia/Tokyo" size="lg" tone="ink" />)
    expect(screen.getByLabelText('Sunday, March 1, 2026')).toHaveTextContent(/^Mar1$/)
  })

  it('shows the weekday when asked', () => {
    render(
      <DateChip date={date} locale="en-US" timeZone="UTC" size="sm" tone="tomato" showWeekday />,
    )
    expect(screen.getByLabelText('Sunday, March 1, 2026')).toHaveTextContent(/^Mar1Sun$/)
  })

  it('drops the abbreviation dot some locales add', () => {
    render(<DateChip date={new Date('2026-01-15T12:00:00Z')} locale="de-DE" timeZone="UTC" />)
    const chip = screen.getByLabelText('Donnerstag, 15. Januar 2026')
    expect(chip).toHaveTextContent(/^Jan15/)
    expect(chip.textContent).not.toContain('.')
  })
})
