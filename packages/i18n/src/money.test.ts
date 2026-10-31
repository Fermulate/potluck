import { describe, expect, it } from 'vitest'
import { formatMoney } from './index'

const NBSP = '\u00a0'

describe('formatMoney', () => {
  it('formats cents as a currency amount', () => {
    expect(formatMoney(123456, 'USD')).toBe('$1,234.56')
    expect(formatMoney(0, 'USD')).toBe('$0.00')
    expect(formatMoney(-500, 'USD')).toBe('-$5.00')
  })

  it('always shows the full set of minor digits so columns line up', () => {
    expect(formatMoney(1200, 'USD')).toBe('$12.00')
    expect(formatMoney(1250, 'BHD')).toBe(`BHD${NBSP}1.250`)
  })

  it('treats zero-decimal currencies as whole units', () => {
    expect(formatMoney(1500, 'JPY')).toBe('¥1,500')
    expect(formatMoney(25000, 'KRW')).toBe('₩25,000')
  })

  it('distinguishes dollars that share a symbol', () => {
    expect(formatMoney(500, 'CAD')).toBe('CA$5.00')
    expect(formatMoney(500, 'CAD', { currencyDisplay: 'narrowSymbol' })).toBe('$5.00')
    expect(formatMoney(500, 'USD', { currencyDisplay: 'code' })).toBe(`USD${NBSP}5.00`)
  })

  it('follows the locale', () => {
    expect(formatMoney(123456, 'EUR', { locale: 'de-DE' })).toBe(`1.234,56${NBSP}€`)
    expect(formatMoney(123456, 'GBP', { locale: 'en-GB' })).toBe('£1,234.56')
  })

  it('can force or hide the sign', () => {
    expect(formatMoney(500, 'USD', { signDisplay: 'always' })).toBe('+$5.00')
    expect(formatMoney(0, 'USD', { signDisplay: 'exceptZero' })).toBe('$0.00')
    expect(formatMoney(-500, 'USD', { signDisplay: 'never' })).toBe('$5.00')
  })

  it('formats a negated zero without a minus', () => {
    expect(formatMoney(-0, 'USD')).toBe('$0.00')
  })

  it('accepts lowercase currency codes', () => {
    expect(formatMoney(1500, 'jpy')).toBe('¥1,500')
  })
})
