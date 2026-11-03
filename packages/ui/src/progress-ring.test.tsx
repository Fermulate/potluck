import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProgressRing } from './progress-ring'
import { preferReducedMotion } from './test/motion'

describe('ProgressRing', () => {
  it('is a named progressbar with a percentage value', () => {
    render(<ProgressRing value={0.666} label="Responses" />)
    const ring = screen.getByRole('progressbar', { name: 'Responses' })
    expect(ring).toHaveAttribute('aria-valuemin', '0')
    expect(ring).toHaveAttribute('aria-valuemax', '100')
    expect(ring).toHaveAttribute('aria-valuenow', '67')
    expect(ring).not.toHaveAttribute('aria-valuetext')
  })

  it('clamps the value to the 0 to 100 range', () => {
    const { rerender } = render(<ProgressRing value={1.4} label="Done" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    rerender(<ProgressRing value={-0.2} label="Done" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('reads a custom value text and shows centered content', () => {
    render(
      <ProgressRing value={4 / 6} label="Responses" valueText="4 of 6 replied" tone="olive">
        4/6
      </ProgressRing>,
    )
    const ring = screen.getByRole('progressbar', { name: 'Responses' })
    expect(ring).toHaveAttribute('aria-valuetext', '4 of 6 replied')
    expect(ring).toHaveTextContent('4/6')
  })

  it('sizes itself from the size prop', () => {
    render(<ProgressRing value={0.5} label="Half" size={80} thickness={8} />)
    expect(screen.getByRole('progressbar')).toHaveStyle({ width: '80px', height: '80px' })
  })

  it('renders the same value with reduced motion', () => {
    preferReducedMotion()
    render(<ProgressRing value={0.25} label="Quarter" />)
    expect(screen.getByRole('progressbar', { name: 'Quarter' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    )
  })
})
