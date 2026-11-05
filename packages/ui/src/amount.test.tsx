import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Amount, formatMoney } from './amount'

describe('formatMoney', () => {
  it('formats cents in the currency with a true minus sign', () => {
    expect(formatMoney(123456, 'USD', { locale: 'en-US' })).toBe('$1,234.56')
    expect(formatMoney(-500, 'USD', { locale: 'en-US' })).toBe('−$5.00')
  })

  it('respects currencies without minor units', () => {
    expect(formatMoney(1500, 'JPY', { locale: 'en-US' })).toBe('¥1,500')
  })

  it('can always show the sign', () => {
    expect(formatMoney(2500, 'EUR', { locale: 'en-US', sign: 'always' })).toBe('+€25.00')
  })
})

describe('Amount', () => {
  it('announces the amount with its currency', () => {
    render(<Amount cents={4200} currency="USD" locale="en-US" />)
    expect(screen.getByText('$42.00')).toHaveClass('sr-only')
  })

  it('marks negative amounts as owed by you', () => {
    const { container } = render(<Amount cents={-1250} currency="USD" locale="en-US" />)
    const root = container.firstElementChild!
    expect(root).toHaveAttribute('data-tone', 'owe')
    expect(root).toHaveTextContent('−$12.50')
  })

  it('marks positive amounts as owed to you', () => {
    const { container } = render(<Amount cents={800} currency="USD" locale="en-US" />)
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'owed')
  })

  it('treats zero as neutral', () => {
    const { container } = render(<Amount cents={0} currency="USD" locale="en-US" />)
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'neutral')
  })

  it('lets callers override the spoken label', () => {
    render(<Amount cents={800} currency="USD" locale="en-US" srLabel="You are owed $8.00" />)
    expect(screen.getByText('You are owed $8.00')).toBeInTheDocument()
  })

  it('announces the final value immediately even while counting up', () => {
    render(<Amount cents={99900} currency="USD" locale="en-US" countUp />)
    expect(screen.getByText('$999.00')).toHaveClass('sr-only')
  })
})
