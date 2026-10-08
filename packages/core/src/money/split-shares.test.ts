import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { splitShares } from '../index'

describe('splitShares', () => {
  it('splits proportionally to share counts', () => {
    expect(splitShares(1200, { a: 2, b: 1, c: 1 })).toEqual({
      ok: true,
      shares: { a: 600, b: 300, c: 300 },
    })
  })

  it('supports fractional shares', () => {
    expect(splitShares(1000, { a: 1.5, b: 0.5 })).toEqual({
      ok: true,
      shares: { a: 750, b: 250 },
    })
  })

  it('distributes leftover cents by largest remainder then user id', () => {
    // exact: a 333.33, b 333.33, c 333.33 -> one leftover cent to a
    expect(splitShares(1000, { c: 1, b: 1, a: 1 })).toEqual({
      ok: true,
      shares: { a: 334, b: 333, c: 333 },
    })
    // exact: a 571.43, b 285.71, c 142.86 -> two leftover cents to c (.86) then b (.71)
    expect(splitShares(1000, { a: 4, b: 2, c: 1 })).toEqual({
      ok: true,
      shares: { a: 571, b: 286, c: 143 },
    })
  })

  it('rejects all-zero shares', () => {
    expect(splitShares(1000, { a: 0, b: 0 })).toEqual({ ok: false, error: { code: 'zero_shares' } })
  })

  it('rejects negative shares, empty splits, and bad totals', () => {
    expect(splitShares(1000, { a: -1, b: 2 })).toEqual({
      ok: false,
      error: { code: 'invalid_weight', userId: 'a' },
    })
    expect(splitShares(1000, {})).toEqual({ ok: false, error: { code: 'no_users' } })
    expect(splitShares(-5, { a: 1 })).toEqual({ ok: false, error: { code: 'invalid_total' } })
  })

  it('always sums exactly to the total', () => {
    const shareMap = fc.dictionary(fc.uuid(), fc.integer({ min: 1, max: 20 }), {
      minKeys: 1,
      maxKeys: 25,
    })
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_00 }), shareMap, (total, shares) => {
        const result = splitShares(total, shares)
        if (!result.ok) throw new Error(JSON.stringify(result.error))
        expect(Object.values(result.shares).reduce((a, b) => a + b, 0)).toBe(total)
      }),
    )
  })
})
