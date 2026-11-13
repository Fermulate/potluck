import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { splitItemized } from '../index'

describe('splitItemized', () => {
  it('charges each person for their own items', () => {
    expect(
      splitItemized([
        { amountCents: 1200, userIds: ['a', 'b', 'c'] },
        { amountCents: 600, userIds: ['a'] },
      ]),
    ).toEqual({ ok: true, shares: { a: 1000, b: 400, c: 400 } })
  })

  it('spreads tax and tip in proportion to each subtotal', () => {
    expect(
      splitItemized(
        [
          { amountCents: 1000, userIds: ['a'] },
          { amountCents: 500, userIds: ['b'] },
        ],
        { taxCents: 120, tipCents: 30 },
      ),
    ).toEqual({ ok: true, shares: { a: 1100, b: 550 } })
  })

  it('rounds once over the whole bill instead of per item', () => {
    // each person owes 66.67 exactly, so only one person absorbs the extra cent
    expect(
      splitItemized([
        { amountCents: 100, userIds: ['a', 'b', 'c'] },
        { amountCents: 100, userIds: ['a', 'b', 'c'] },
      ]),
    ).toEqual({ ok: true, shares: { a: 67, b: 67, c: 66 } })
  })

  it('assigns tip leftovers deterministically', () => {
    expect(
      splitItemized(
        [
          { amountCents: 1000, userIds: ['c'] },
          { amountCents: 1000, userIds: ['b'] },
          { amountCents: 1000, userIds: ['a'] },
        ],
        { tipCents: 100 },
      ),
    ).toEqual({ ok: true, shares: { a: 1034, b: 1033, c: 1033 } })
  })

  it('reports item problems with the item index', () => {
    expect(splitItemized([{ amountCents: 100, userIds: [] }])).toEqual({
      ok: false,
      error: { code: 'item_no_users', index: 0 },
    })
    expect(
      splitItemized([
        { amountCents: 100, userIds: ['a'] },
        { amountCents: -1, userIds: ['a'] },
      ]),
    ).toEqual({ ok: false, error: { code: 'invalid_item_amount', index: 1 } })
    expect(splitItemized([{ amountCents: 100, userIds: ['a', 'a'] }])).toEqual({
      ok: false,
      error: { code: 'duplicate_user', userId: 'a' },
    })
  })

  it('rejects an empty bill, bad tax or tip, and extras on a zero subtotal', () => {
    expect(splitItemized([])).toEqual({ ok: false, error: { code: 'no_items' } })
    expect(splitItemized([{ amountCents: 100, userIds: ['a'] }], { taxCents: -1 })).toEqual({
      ok: false,
      error: { code: 'invalid_extra' },
    })
    expect(splitItemized([{ amountCents: 0, userIds: ['a'] }], { tipCents: 100 })).toEqual({
      ok: false,
      error: { code: 'zero_shares' },
    })
  })

  it('allows a free bill', () => {
    expect(splitItemized([{ amountCents: 0, userIds: ['a', 'b'] }])).toEqual({
      ok: true,
      shares: { a: 0, b: 0 },
    })
  })

  it('always sums exactly to items plus tax plus tip', () => {
    const people = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']
    const item = fc.record({
      amountCents: fc.integer({ min: 1, max: 100_000 }),
      userIds: fc.subarray(people, { minLength: 1 }),
    })
    fc.assert(
      fc.property(
        fc.array(item, { minLength: 1, maxLength: 15 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (items, taxCents, tipCents) => {
          const result = splitItemized(items, { taxCents, tipCents })
          if (!result.ok) throw new Error(JSON.stringify(result.error))
          const expected = items.reduce((sum, i) => sum + i.amountCents, 0) + taxCents + tipCents
          expect(Object.values(result.shares).reduce((a, b) => a + b, 0)).toBe(expected)
        },
      ),
    )
  })

  // The same cases run against `private.itemized_splits` in
  // supabase/tests/17_expense_entry.test.sql.
  it('takes a discount off in proportion to each subtotal', () => {
    expect(
      splitItemized(
        [
          { amountCents: 1000, userIds: ['a'] },
          { amountCents: 500, userIds: ['b'] },
        ],
        { taxCents: 120, tipCents: 30, discountCents: 150 },
      ),
    ).toEqual({ ok: true, shares: { a: 1000, b: 500 } })
    expect(
      splitItemized([{ amountCents: 100, userIds: ['a', 'b', 'c'] }], { discountCents: 10 }),
    ).toEqual({ ok: true, shares: { a: 30, b: 30, c: 30 } })
    expect(
      splitItemized(
        [
          { amountCents: 1000, userIds: ['a', 'b'] },
          { amountCents: 333, userIds: ['c'] },
        ],
        { taxCents: 101, discountCents: 7 },
      ),
    ).toEqual({ ok: true, shares: { a: 535, b: 535, c: 357 } })
  })

  it('refuses a discount bigger than the bill', () => {
    expect(splitItemized([{ amountCents: 100, userIds: ['a'] }], { discountCents: 101 })).toEqual({
      ok: false,
      error: { code: 'invalid_extra' },
    })
    expect(splitItemized([{ amountCents: 100, userIds: ['a'] }], { discountCents: -1 })).toEqual({
      ok: false,
      error: { code: 'invalid_extra' },
    })
  })
})
