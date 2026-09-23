import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { simplifyDebts } from '../index'

describe('simplifyDebts', () => {
  it('has debtors pay the creditor', () => {
    expect(simplifyDebts({ a: 600, b: -300, c: -300 })).toEqual([
      { fromUser: 'b', toUser: 'a', amountCents: 300 },
      { fromUser: 'c', toUser: 'a', amountCents: 300 },
    ])
  })

  it('collapses a chain of debts into one payment', () => {
    expect(simplifyDebts({ a: -10, b: 0, c: 10 })).toEqual([
      { fromUser: 'a', toUser: 'c', amountCents: 10 },
    ])
  })

  it('matches the largest creditor with the largest debtor first, ties by user id', () => {
    expect(simplifyDebts({ d: -400, c: -400, b: 300, a: 500 })).toEqual([
      { fromUser: 'c', toUser: 'a', amountCents: 400 },
      { fromUser: 'd', toUser: 'b', amountCents: 300 },
      { fromUser: 'd', toUser: 'a', amountCents: 100 },
    ])
  })

  it('returns nothing when everyone is settled', () => {
    expect(simplifyDebts({})).toEqual([])
    expect(simplifyDebts({ a: 0, b: 0 })).toEqual([])
  })

  it('throws when balances do not net to zero', () => {
    expect(() => simplifyDebts({ a: 10, b: -5 })).toThrow(RangeError)
  })

  it('settles everyone with at most n - 1 payments', () => {
    const balances = fc
      .array(fc.integer({ min: -1_000_000, max: 1_000_000 }), { minLength: 1, maxLength: 20 })
      .map((values) => {
        const sum = values.reduce((a, b) => a + b, 0)
        const all = [...values, -sum]
        return Object.fromEntries(all.map((v, i) => [`user-${String(i).padStart(2, '0')}`, v]))
      })
    fc.assert(
      fc.property(balances, (input) => {
        const transfers = simplifyDebts(input)
        const remaining = { ...input }
        for (const t of transfers) {
          expect(t.amountCents).toBeGreaterThan(0)
          expect(t.fromUser).not.toBe(t.toUser)
          remaining[t.fromUser]! += t.amountCents
          remaining[t.toUser]! -= t.amountCents
        }
        expect(Object.values(remaining).every((v) => v === 0)).toBe(true)
        const active = Object.values(input).filter((v) => v !== 0).length
        expect(transfers.length).toBeLessThanOrEqual(Math.max(0, active - 1))
      }),
    )
  })
})
