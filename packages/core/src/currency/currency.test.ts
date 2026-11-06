import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { convert, invertRate, minorUnits, parseAmount } from '../index'

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

  it('keeps 12 decimals of the rate, like the database', () => {
    // 100,000,000.00 IDR at 0.000061714286 USD per rupiah is $6,171.43 (8 decimals gave $6,171.00)
    expect(convert(10_000_000_000, '0.000061714286', { from: 'IDR', to: 'USD' })).toBe(617_143)
    expect(convert(10_000_000_000, 0.000061714286, { from: 'IDR', to: 'USD' })).toBe(617_143)
    // a large rate keeps every digit when passed as text
    expect(convert(1_000_000_000, '16000.123456789012', { from: 'USD', to: 'IDR' })).toBe(
      16_000_123_456_789,
    )
    // rounded half up at the 12th decimal, like a cast to numeric(24,12)
    expect(convert(10 ** 12, '0.0000000000015')).toBe(2)
    expect(convert(10 ** 12, '0.0000000000014')).toBe(1)
  })

  it('needs the rate as text once it has more digits than a JS number holds', () => {
    // numeric(24,12) keeps 17 digits here; JSON.parse keeps about 16 (16000.123456789011).
    // The database credits 888,336,454.40; the parsed number would give one cent less.
    expect(convert(5_552_060, '16000.123456789012')).toBe(88_833_645_440)
    expect(convert(5_552_060, JSON.parse('16000.123456789012') as number)).toBe(88_833_645_439)
  })

  it('throws on a non-positive or invalid rate', () => {
    expect(() => convert(100, 0)).toThrow(RangeError)
    expect(() => convert(100, -1)).toThrow(RangeError)
    expect(() => convert(100, 'abc')).toThrow(RangeError)
    expect(() => convert(100, 1e-13)).toThrow(RangeError)
    expect(() => convert(1.5, 1)).toThrow(RangeError)
  })
})

describe('invertRate', () => {
  it('matches round(1 / rate, 12) in Postgres', () => {
    // Values from `select round(1 / x::numeric(24,12), 12)` on the local database.
    expect(invertRate('16000.123456789012')).toBe('0.000062499518')
    expect(invertRate('0.000057600000')).toBe('17361.111111111111')
    expect(invertRate('1.084')).toBe('0.922509225092')
    expect(invertRate('3.000000000007')).toBe('0.333333333333')
    expect(invertRate('0.000000000003')).toBe('333333333333.333333333333')
  })

  it('rounds the quotient at the Postgres division scale before rounding to 12 places', () => {
    // Postgres computes a numeric quotient to at least 16 significant digits (select_div_scale in
    // numeric.c), so 1 / 0.111518261468 is 8.9671412272415000 when round(..., 12) rounds it half
    // up. Rounding the exact quotient once would give 8.967141227241.
    expect(invertRate('0.111518261468')).toBe('8.967141227242')
  })

  it('keeps digits a JS number would drop', () => {
    expect(String(Number((1 / 0.0000576).toFixed(12)))).toBe('17361.111111111113')
    expect(invertRate(0.0000576)).toBe('17361.111111111111')
    expect(convert(1_000_000, invertRate(0.0000576))).toBe(convert(1_000_000, '17361.111111111111'))
  })

  it('round-trips for exact rates', () => {
    expect(invertRate('0.5')).toBe('2.000000000000')
    expect(invertRate(invertRate('0.5'))).toBe('0.500000000000')
    expect(invertRate(1)).toBe('1.000000000000')
  })

  it('throws on a rate it cannot invert', () => {
    expect(() => invertRate(0)).toThrow(RangeError)
    expect(() => invertRate('abc')).toThrow(RangeError)
    expect(() => invertRate('3000000000000')).toThrow(RangeError)
  })
})
