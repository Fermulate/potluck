import { describe, expect, it } from 'vitest'
import { splitAdjustment, splitEqual, splitPercent, splitShares } from './split'

// Twin of supabase/tests/31_split_rounding.test.sql: same people, same cases, same answers.
// Every weighted split rounds the same way: floor each exact share, then the cents left over go
// one each to the largest remainders, ties to the smaller user id (never to whoever is listed
// first). So the same split typed as percents, shares or adjustments charges the extra cent to
// the same person.
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'

const sharesOf = (result: ReturnType<typeof splitPercent>) => {
  if (!result.ok) throw new Error(result.error.code)
  return result.shares
}

describe('the leftover cent', () => {
  it('goes to the smaller user id on a tie, in every mode', () => {
    // 1.01 between two people: 50.5 cents each.
    const expected = { [A]: 51, [B]: 50 }
    expect(sharesOf(splitEqual(101, [B, A]))).toEqual(expected)
    expect(sharesOf(splitPercent(101, { [B]: 50, [A]: 50 }))).toEqual(expected)
    expect(sharesOf(splitShares(101, { [B]: 1, [A]: 1 }))).toEqual(expected)
    expect(sharesOf(splitAdjustment(101, { [B]: 0, [A]: 0 }))).toEqual(expected)
  })

  it('goes to the largest remainder before any tie break', () => {
    // 10.01 at 50 / 30 / 20: 500.5, 300.3 and 200.2.
    const expected = { [A]: 501, [B]: 300, [C]: 200 }
    expect(sharesOf(splitPercent(1001, { [C]: 20, [B]: 30, [A]: 50 }))).toEqual(expected)
    expect(sharesOf(splitShares(1001, { [C]: 2, [B]: 3, [A]: 5 }))).toEqual(expected)
  })

  it('reaches the largest remainder even when it is not the smallest id', () => {
    // 1.01 at 25 / 25 / 50: 25.25, 25.25 and 50.5.
    const expected = { [A]: 25, [B]: 25, [C]: 51 }
    expect(sharesOf(splitPercent(101, { [A]: 25, [B]: 25, [C]: 50 }))).toEqual(expected)
    expect(sharesOf(splitShares(101, { [A]: 1, [B]: 1, [C]: 2 }))).toEqual(expected)
  })

  it('rounds only the equal part of an adjustment split', () => {
    // 10.00 with 1.00 more for C: 9.00 left, 3.00 each, nothing over. 10.01: A takes the cent.
    expect(sharesOf(splitAdjustment(1000, { [A]: 0, [B]: 0, [C]: 100 }))).toEqual({
      [A]: 300,
      [B]: 300,
      [C]: 400,
    })
    expect(sharesOf(splitAdjustment(1001, { [C]: 100, [B]: 0, [A]: 0 }))).toEqual({
      [A]: 301,
      [B]: 300,
      [C]: 400,
    })
  })

  it('keeps typed percents with decimals exact until the cents are worked out', () => {
    // 100.01 at 33.33 / 33.33 / 33.34: 3333.33, 3333.33 and 3334.33 (and a bit).
    expect(sharesOf(splitPercent(10001, { [A]: 33.33, [B]: 33.33, [C]: 33.34 }))).toEqual({
      [A]: 3333,
      [B]: 3333,
      [C]: 3335,
    })
  })
})
