import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { splitEqual } from '../index'

const userIds = fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 30 })
const total = fc.integer({ min: 0, max: 10_000_000_00 })

describe('splitEqual', () => {
  it('splits a total that divides evenly', () => {
    expect(splitEqual(900, ['a', 'b', 'c'])).toEqual({
      ok: true,
      shares: { a: 300, b: 300, c: 300 },
    })
  })

  it('gives leftover cents to users in sorted id order', () => {
    expect(splitEqual(1000, ['c', 'a', 'b'])).toEqual({
      ok: true,
      shares: { a: 334, b: 333, c: 333 },
    })
    expect(splitEqual(1001, ['c', 'b', 'a'])).toEqual({
      ok: true,
      shares: { a: 334, b: 334, c: 333 },
    })
  })

  it('handles a zero total', () => {
    expect(splitEqual(0, ['a', 'b'])).toEqual({ ok: true, shares: { a: 0, b: 0 } })
  })

  it('rejects an empty user list', () => {
    expect(splitEqual(100, [])).toEqual({ ok: false, error: { code: 'no_users' } })
  })

  it('rejects duplicate users', () => {
    expect(splitEqual(100, ['a', 'a'])).toEqual({
      ok: false,
      error: { code: 'duplicate_user', userId: 'a' },
    })
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects a total of %s', (bad) => {
    expect(splitEqual(bad, ['a'])).toEqual({ ok: false, error: { code: 'invalid_total' } })
  })

  it('always sums exactly to the total, and shares differ by at most one cent', () => {
    fc.assert(
      fc.property(total, userIds, (t, ids) => {
        const result = splitEqual(t, ids)
        if (!result.ok) return false
        const values = Object.values(result.shares)
        expect(values.reduce((a, b) => a + b, 0)).toBe(t)
        expect(Object.keys(result.shares).sort()).toEqual([...ids].sort())
        expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1)
        return true
      }),
    )
  })

  it('does not depend on input order', () => {
    fc.assert(
      fc.property(total, userIds, (t, ids) => {
        expect(splitEqual(t, [...ids].reverse())).toEqual(splitEqual(t, ids))
      }),
    )
  })
})
