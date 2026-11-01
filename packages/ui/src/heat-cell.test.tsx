import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HeatCell } from './heat-cell'

describe('HeatCell', () => {
  it('exposes its level and takes the label and handlers from the painter', async () => {
    const ref = createRef<HTMLDivElement>()
    const onPointerDown = vi.fn()
    render(
      <HeatCell
        ref={ref}
        level={3}
        role="gridcell"
        aria-label="Fri 18:00, 3 of 4 free"
        onPointerDown={onPointerDown}
      />,
    )
    const cell = screen.getByRole('gridcell', { name: 'Fri 18:00, 3 of 4 free' })
    expect(cell).toHaveAttribute('data-level', '3')
    expect(cell).not.toHaveAttribute('data-selected')
    expect(ref.current).toBe(cell)
    await userEvent.pointer({ keys: '[MouseLeft>]', target: cell })
    expect(onPointerDown).toHaveBeenCalledOnce()
  })

  it('marks selection and shows a hidden dot for the viewer pick', () => {
    render(
      <>
        <HeatCell level={4} selected busy mine="yes" data-testid="yes" />
        <HeatCell level={0} mine="maybe" data-testid="maybe" />
        <HeatCell level={1} data-testid="none" />
      </>,
    )
    expect(screen.getByTestId('yes')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByTestId('yes').firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('maybe').firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('none')).toBeEmptyDOMElement()
  })
})
