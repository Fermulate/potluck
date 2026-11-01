import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Stamp, StampAnimation } from './stamp'
import { preferReducedMotion } from './test/motion'

describe('Stamp', () => {
  it('shows the caption above the main text', () => {
    render(
      <Stamp caption="12 MAR" tone="olive">
        Settled
      </Stamp>,
    )
    expect(screen.getByText('12 MAR')).toBeInTheDocument()
    expect(screen.getByText('Settled').parentElement).toHaveTextContent(/^12 MARSettled$/)
  })

  it('works without a caption', () => {
    render(<Stamp>Paid</Stamp>)
    expect(screen.getByText('Paid').parentElement).toHaveTextContent(/^Paid$/)
  })
})

describe('StampAnimation', () => {
  it('shows its child only while show is true', async () => {
    const { rerender } = render(
      <StampAnimation show={false}>
        <span>Booked</span>
      </StampAnimation>,
    )
    expect(screen.queryByText('Booked')).not.toBeInTheDocument()

    rerender(
      <StampAnimation show>
        <span>Booked</span>
      </StampAnimation>,
    )
    expect(screen.getByText('Booked')).toBeInTheDocument()

    rerender(
      <StampAnimation show={false}>
        <span>Booked</span>
      </StampAnimation>,
    )
    await waitFor(() => expect(screen.queryByText('Booked')).not.toBeInTheDocument())
  })

  it('skips the ink ring with reduced motion', () => {
    preferReducedMotion()
    render(
      <StampAnimation show rotate={4}>
        <span>Booked</span>
      </StampAnimation>,
    )
    const wrapper = screen.getByText('Booked').parentElement!
    expect(wrapper.querySelector('[aria-hidden]')).toBeNull()
  })

  it('adds a decorative ink ring otherwise', () => {
    render(
      <StampAnimation show>
        <span>Booked</span>
      </StampAnimation>,
    )
    const wrapper = screen.getByText('Booked').parentElement!
    expect(wrapper.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})
