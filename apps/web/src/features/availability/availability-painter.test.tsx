import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AvailabilityPainter } from './availability-painter'
import { buildGridModel, type PaintLevel } from './grid'

const model = buildGridModel(
  {
    window_start: '2026-06-12',
    window_end: '2026-06-14',
    day_start_minute: 18 * 60,
    day_end_minute: 20 * 60,
    slot_minutes: 30,
    timezone: 'UTC',
  },
  'UTC',
)

const slot = (day: number, time: string) => `2026-06-${day}T${time}:00.000Z`

function Harness({ onChange }: { onChange?: (next: Map<string, PaintLevel>) => void }) {
  const [value, setValue] = useState(new Map<string, PaintLevel>())
  return (
    <AvailabilityPainter
      model={model}
      value={value}
      label="Your times"
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

const cell = (s: string) => document.querySelector<HTMLElement>(`[data-slot="${s}"]`)!

describe('AvailabilityPainter', () => {
  it('paints a rectangle while dragging and toggles off when starting on a painted cell', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const grid = screen.getByRole('grid', { name: 'Your times' })

    fireEvent.pointerDown(cell(slot(12, '18:00')), { pointerId: 1 })
    fireEvent.pointerMove(cell(slot(13, '19:00')), { pointerId: 1 })
    fireEvent.pointerUp(grid, { pointerId: 1 })

    const painted = within(grid)
      .getAllByRole('gridcell', { selected: true })
      .map((el) => el.dataset.slot)
    expect(painted).toHaveLength(6)
    expect(painted).toContain(slot(13, '18:30'))
    expect(onChange.mock.lastCall?.[0].get(slot(12, '19:00'))).toBe('yes')

    fireEvent.pointerDown(cell(slot(12, '18:00')), { pointerId: 2 })
    fireEvent.pointerUp(grid, { pointerId: 2 })
    expect(cell(slot(12, '18:00'))).toHaveAttribute('aria-selected', 'false')
  })

  it('paints maybe with the maybe brush', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: /maybe/i }))
    fireEvent.pointerDown(cell(slot(14, '19:30')), { pointerId: 1 })
    expect(onChange.mock.lastCall?.[0].get(slot(14, '19:30'))).toBe('maybe')
  })

  it('works with the keyboard: arrows move, space paints, shift extends', () => {
    render(<Harness />)
    const first = cell(slot(12, '18:00'))
    expect(first).toHaveAttribute('tabindex', '0')
    first.focus()

    fireEvent.keyDown(first, { key: ' ' })
    expect(first).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(first, { key: 'ArrowDown', shiftKey: true })
    const second = cell(slot(12, '18:30'))
    expect(second).toHaveAttribute('aria-selected', 'true')
    expect(second).toHaveFocus()

    fireEvent.keyDown(second, { key: 'ArrowRight' })
    const third = cell(slot(13, '18:30'))
    expect(third).toHaveFocus()
    expect(third).toHaveAttribute('aria-selected', 'false')
    expect(third).toHaveAttribute('tabindex', '0')
  })
})
