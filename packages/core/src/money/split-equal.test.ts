import { describe, expect, it } from 'vitest'
import { splitEqual } from '../index'

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
})
