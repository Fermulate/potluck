import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { roundedUp, splitEqual, splitItemized, splitPercent, splitShares } from '../index'

function shares(result: ReturnType<typeof splitEqual>) {
  if (!result.ok) throw new Error(result.error.code)
  return result.shares
}

describe('roundedUp', () => {
  it('finds nobody when the total divides evenly', () => {
    const userIds = ['a', 'b', 'c']
    expect(roundedUp({ mode: 'equal', userIds }, shares(splitEqual(3000, userIds)))).toEqual([])
  })

  it('names who carries the leftover cent of an equal split', () => {
    const userIds = ['c', 'a', 'b']
    const split = shares(splitEqual(1000, userIds))
    expect(split).toEqual({ a: 334, b: 333, c: 333 })
    expect(roundedUp({ mode: 'equal', userIds }, split)).toEqual(['a'])
  })

  it('works for percent and share splits', () => {
    const percents = { a: 50, b: 25, c: 25 }
    expect(roundedUp({ mode: 'percent', percents }, shares(splitPercent(101, percents)))).toEqual([
      'a',
    ])
    const shareCounts = { a: 2, b: 1 }
    expect(
      roundedUp({ mode: 'shares', shareCounts }, shares(splitShares(100, shareCounts))),
    ).toEqual(['a'])
  })

  it('matches the guide: $193.88 by item over six people leaves two cents', () => {
    const people = ['jo', 'kai', 'lena', 'maya', 'noor', 'sam']
    const items = [{ amountCents: 19388, userIds: people }]
    expect(roundedUp({ mode: 'itemized', items }, shares(splitItemized(items)))).toHaveLength(2)
  })

  it('always names exactly as many people as there are leftover cents', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 9 }),
        (total, userIds) => {
          const split = shares(splitEqual(total, userIds))
          const extra = roundedUp({ mode: 'equal', userIds }, split)
          expect(extra).toHaveLength(total % userIds.length)
          const floor = Math.floor(total / userIds.length)
          for (const id of extra) expect(split[id]).toBe(floor + 1)
        },
      ),
    )
  })
})
