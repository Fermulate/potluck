import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { convert, minorUnits, parseAmount } from '../index'

describe('parseAmount', () => {
  it('parses typed amounts into minor units', () => {
    expect(parseAmount('12.34', 'USD')).toBe(1234)
    expect(parseAmount('12', 'USD')).toBe(1200)
    expect(parseAmount('12.5', 'USD')).toBe(1250)
    expect(parseAmount(' 7.5 ', 'USD')).toBe(750)
    expect(parseAmount('.99', 'USD')).toBe(99)
    expect(parseAmount('1,234.56', 'USD')).toBe(123456)
    expect(parseAmount('1500', 'JPY')).toBe(1500)
    expect(parseAmount('1.250', 'BHD')).toBe(1250)
  })

  it('returns null for anything that is not a valid amount', () => {
    expect(parseAmount('', 'USD')).toBeNull()
    expect(parseAmount('abc', 'USD')).toBeNull()
    expect(parseAmount('12.345', 'USD')).toBeNull()
    expect(parseAmount('10.5', 'JPY')).toBeNull()
    expect(parseAmount('-5', 'USD')).toBeNull()
    expect(parseAmount('1.2.3', 'USD')).toBeNull()
    expect(parseAmount('99999999999999999', 'USD')).toBeNull()
  })

  it('round trips any cent amount', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e13 }), (cents) => {
        const text = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
        expect(parseAmount(text, 'USD')).toBe(cents)
      }),
    )
  })
})

describe('minorUnits', () => {
  it('knows zero and three decimal currencies', () => {
    expect(minorUnits('USD')).toBe(2)
    expect(minorUnits('EUR')).toBe(2)
    expect(minorUnits('JPY')).toBe(0)
    expect(minorUnits('KRW')).toBe(0)
    expect(minorUnits('BHD')).toBe(3)
  })

  it('is case insensitive and defaults to 2', () => {
    expect(minorUnits('jpy')).toBe(0)
    expect(minorUnits('XYZ')).toBe(2)
  })
})

describe('convert', () => {
  it('multiplies by the rate', () => {
    expect(convert(1000, 1.1)).toBe(1100)
    expect(convert(1000, '0.91234567')).toBe(912)
  })

  it('rounds half up (away from zero), like Postgres round()', () => {
    expect(convert(1005, 0.5)).toBe(503)
    expect(convert(1003, 0.5)).toBe(502)
    expect(convert(-1005, 0.5)).toBe(-503)
    expect(convert(1, 0.49999999)).toBe(0)
  })

  it('accounts for different minor units between currencies', () => {
    // 10,000 yen at 0.0067 USD per yen is $67.00
    expect(convert(10_000, 0.0067, { from: 'JPY', to: 'USD' })).toBe(6700)
    // $10.00 at 150.123 yen per dollar is 1,501.23 yen, rounded to 1,501
    expect(convert(1000, 150.123, { from: 'USD', to: 'JPY' })).toBe(1501)
    // 1.000 BHD at 2.65 USD per dinar
    expect(convert(1000, 2.65, { from: 'BHD', to: 'USD' })).toBe(265)
  })

  it('is the identity at rate 1', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), (cents) => {
        expect(convert(cents, 1)).toBe(cents)
        expect(convert(cents, '1.00000000', { from: 'KRW', to: 'KRW' })).toBe(cents)
      }),
    )
  })

  it('throws on a non-positive or invalid rate', () => {
    expect(() => convert(100, 0)).toThrow(RangeError)
    expect(() => convert(100, -1)).toThrow(RangeError)
    expect(() => convert(100, 'abc')).toThrow(RangeError)
    expect(() => convert(1.5, 1)).toThrow(RangeError)
  })
})
