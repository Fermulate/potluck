import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { roundedUp, splitAdjustment } from '../index'

// The same cases run against `private.compute_split_rows` in
// supabase/tests/17_expense_entry.test.sql.
describe('splitAdjustment', () => {
  it('adds each adjustment on top of an equal split of the rest', () => {
    // 100 between three with +10 on a: 90 split equally, then a gets 10 more.
    expect(splitAdjustment(10000, { a: 1000, b: 0, c: 0 })).toEqual({
      ok: true,
      shares: { a: 4000, b: 3000, c: 3000 },
    })
  })

  it('takes a minus adjustment off and rounds the equal part by id', () => {
    // 10.00 with -1.00 on b: 11.00 split three ways is 3.67, 3.67, 3.66.
    expect(splitAdjustment(1000, { a: 0, b: -100, c: 0 })).toEqual({
      ok: true,
      shares: { a: 367, b: 267, c: 366 },
    })
  })

  it('works with nobody adjusted (same as equal)', () => {
    expect(splitAdjustment(1000, { c: 0, a: 0, b: 0 })).toEqual({
      ok: true,
      shares: { a: 334, b: 333, c: 333 },
    })
  })

  it('refuses adjustments larger than the total', () => {
    expect(splitAdjustment(1000, { a: 800, b: 300 })).toEqual({
      ok: false,
      error: { code: 'adjustments_exceed_total', difference: 100 },
    })
  })

  it('refuses a minus adjustment that leaves someone below zero', () => {
    expect(splitAdjustment(1000, { a: 0, b: -1100 })).toEqual({
      ok: false,
      error: { code: 'negative_share', userId: 'b' },
    })
  })

  it('validates the total, the people and the amounts', () => {
    expect(splitAdjustment(-1, { a: 0 })).toEqual({
      ok: false,
      error: { code: 'invalid_total' },
    })
    expect(splitAdjustment(100, {})).toEqual({ ok: false, error: { code: 'no_users' } })
    expect(splitAdjustment(100, { a: 1.5 })).toEqual({
      ok: false,
      error: { code: 'invalid_amount', userId: 'a' },
    })
  })

  it('always adds up to the total when it succeeds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.dictionary(fc.uuid(), fc.integer({ min: -5000, max: 5000 }), { minKeys: 1 }),
        (total, adjustments) => {
          const result = splitAdjustment(total, adjustments)
          if (!result.ok) return
          const sum = Object.values(result.shares).reduce((a, b) => a + b, 0)
          expect(sum).toBe(total)
          for (const share of Object.values(result.shares)) expect(share).toBeGreaterThanOrEqual(0)
        },
      ),
    )
  })

  it('says who got a rounded up cent, looking only at the equal part', () => {
    const adjustments = { a: 0, b: -100, c: 0 }
    const result = splitAdjustment(1000, adjustments)
    if (!result.ok) throw new Error('expected a split')
    expect(roundedUp({ mode: 'adjustment', adjustments }, result.shares)).toEqual(['a', 'b'])
    expect(roundedUp({ mode: 'adjustment', adjustments: { a: 1000, b: 0 } }, { a: 1500, b: 500 }))
      .toEqual([])
  })
})
