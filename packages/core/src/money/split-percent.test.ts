import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { splitPercent } from '../index'

/** Random percent maps (basis-point precision) that add up to exactly 100. */
const percentMap = fc
  .uniqueArray(fc.integer({ min: 1, max: 9_999 }), { maxLength: 12 })
  .chain((cuts) => {
    const points = [0, ...cuts.sort((a, b) => a - b), 10_000]
    const parts = points.slice(1).map((p, i) => (p - points[i]!) / 100)
    return fc
      .uniqueArray(fc.uuid(), { minLength: parts.length, maxLength: parts.length })
      .map((ids) => Object.fromEntries(ids.map((id, i) => [id, parts[i]!])))
  })

describe('splitPercent', () => {
  it('splits by whole percents', () => {
    expect(splitPercent(1000, { a: 50, b: 30, c: 20 })).toEqual({
      ok: true,
      shares: { a: 500, b: 300, c: 200 },
    })
  })

  it('gives the leftover cent to the largest fractional remainder', () => {
    expect(splitPercent(1000, { a: 33.33, b: 33.33, c: 33.34 })).toEqual({
      ok: true,
      shares: { a: 333, b: 333, c: 334 },
    })
  })

  it('breaks remainder ties by user id', () => {
    expect(splitPercent(100, { z: 33.5, y: 33.5, x: 33 })).toEqual({
      ok: true,
      shares: { x: 33, y: 34, z: 33 },
    })
  })

  it('keeps people at zero percent in the result', () => {
    expect(splitPercent(100, { a: 100, b: 0 })).toEqual({ ok: true, shares: { a: 100, b: 0 } })
  })

  it('reports percents that do not add up to 100', () => {
    expect(splitPercent(1000, { a: 50, b: 40 })).toEqual({
      ok: false,
      error: { code: 'percent_sum', actual: 90 },
    })
    expect(splitPercent(1000, { a: 33.333, b: 33.333, c: 33.333 })).toEqual({
      ok: false,
      error: { code: 'percent_sum', actual: 99.999 },
    })
  })

  it('rejects negative or non-finite percents', () => {
    expect(splitPercent(1000, { a: 110, b: -10 })).toEqual({
      ok: false,
      error: { code: 'invalid_weight', userId: 'b' },
    })
    expect(splitPercent(1000, { a: Number.NaN })).toEqual({
      ok: false,
      error: { code: 'invalid_weight', userId: 'a' },
    })
  })

  it('rejects an empty split and a bad total', () => {
    expect(splitPercent(1000, {})).toEqual({ ok: false, error: { code: 'no_users' } })
    expect(splitPercent(10.5, { a: 100 })).toEqual({ ok: false, error: { code: 'invalid_total' } })
  })

  it('always sums exactly to the total and stays within a cent of the exact share', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_00 }), percentMap, (total, percents) => {
        const result = splitPercent(total, percents)
        if (!result.ok) throw new Error(JSON.stringify(result.error))
        const sum = Object.values(result.shares).reduce((a, b) => a + b, 0)
        expect(sum).toBe(total)
        for (const [id, pct] of Object.entries(percents)) {
          expect(Math.abs(result.shares[id]! - (total * pct) / 100)).toBeLessThan(1 + 1e-6)
        }
      }),
    )
  })
})
