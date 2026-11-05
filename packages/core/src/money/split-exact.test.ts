import { describe, expect, it } from 'vitest'
import { splitExact } from '../index'

describe('splitExact', () => {
  it('accepts amounts that add up to the total', () => {
    expect(splitExact(1000, { a: 250, b: 750 })).toEqual({
      ok: true,
      shares: { a: 250, b: 750 },
    })
  })

  it('reports how far off the amounts are', () => {
    expect(splitExact(1000, { a: 250, b: 700 })).toEqual({
      ok: false,
      error: { code: 'sum_mismatch', expected: 1000, actual: 950, difference: 50 },
    })
    expect(splitExact(1000, { a: 600, b: 700 })).toEqual({
      ok: false,
      error: { code: 'sum_mismatch', expected: 1000, actual: 1300, difference: -300 },
    })
  })

  it('rejects negative or fractional amounts', () => {
    expect(splitExact(100, { a: 150, b: -50 })).toEqual({
      ok: false,
      error: { code: 'invalid_amount', userId: 'b' },
    })
    expect(splitExact(100, { a: 50.5, b: 49.5 })).toEqual({
      ok: false,
      error: { code: 'invalid_amount', userId: 'a' },
    })
  })

  it('rejects an empty split and a bad total', () => {
    expect(splitExact(100, {})).toEqual({ ok: false, error: { code: 'no_users' } })
    expect(splitExact(-100, { a: -100 })).toEqual({ ok: false, error: { code: 'invalid_total' } })
  })
})
