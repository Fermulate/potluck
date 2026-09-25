import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { computeBalances, splitEqual, type BalanceExpense, type BalanceSettlement } from '../index'

const dinner: BalanceExpense = {
  paidBy: 'a',
  amountCents: 900,
  splits: [
    { userId: 'a', shareCents: 300 },
    { userId: 'b', shareCents: 300 },
    { userId: 'c', shareCents: 300 },
  ],
}

describe('computeBalances', () => {
  it('credits the payer and debits everyone in the split', () => {
    expect(computeBalances([dinner])).toEqual({ a: 600, b: -300, c: -300 })
  })

  it('applies settlements: paying back raises the payer and lowers the receiver', () => {
    const settlements: BalanceSettlement[] = [{ fromUser: 'b', toUser: 'a', amountCents: 300 }]
    expect(computeBalances([dinner], settlements)).toEqual({ a: 300, b: 0, c: -300 })
  })

  it('ignores soft-deleted expenses and settlements', () => {
    expect(
      computeBalances(
        [dinner, { ...dinner, paidBy: 'b', deletedAt: '2026-01-01T00:00:00Z' }],
        [{ fromUser: 'c', toUser: 'a', amountCents: 300, deletedAt: '2026-01-02T00:00:00Z' }],
      ),
    ).toEqual({ a: 600, b: -300, c: -300 })
  })

  it('skips an expense with no shares to charge', () => {
    expect(
      computeBalances([
        { paidBy: 'a', amountCents: 500, splits: [{ userId: 'b', shareCents: 0 }] },
      ]),
    ).toEqual({})
  })

  it('converts foreign currency expenses into the group currency', () => {
    expect(
      computeBalances([
        {
          paidBy: 'a',
          amountCents: 1000,
          fxRate: 1.1,
          splits: [
            { userId: 'a', shareCents: 500 },
            { userId: 'b', shareCents: 500 },
          ],
        },
      ]),
    ).toEqual({ a: 550, b: -550 })
  })

  it('keeps converted splits summing to the converted total', () => {
    // 1000 * 1.0005 = 1000.5 -> 1001; the extra cent goes to the largest remainder (c)
    expect(
      computeBalances([
        {
          paidBy: 'a',
          amountCents: 1000,
          fxRate: '1.0005',
          splits: [
            { userId: 'a', shareCents: 333 },
            { userId: 'b', shareCents: 333 },
            { userId: 'c', shareCents: 334 },
          ],
        },
      ]),
    ).toEqual({ a: 1001 - 333, b: -333, c: -335 })
  })

  it('respects minor units when converting between currencies', () => {
    expect(
      computeBalances(
        [
          {
            paidBy: 'a',
            amountCents: 1000,
            currency: 'JPY',
            fxRate: 0.0067,
            splits: [
              { userId: 'a', shareCents: 500 },
              { userId: 'b', shareCents: 500 },
            ],
          },
        ],
        [{ fromUser: 'b', toUser: 'a', amountCents: 500, currency: 'JPY', fxRate: 0.0067 }],
        { groupCurrency: 'USD' },
      ),
    ).toEqual({ a: 0, b: 0 })
  })

  it('always nets to zero across the group', () => {
    const people = ['u1', 'u2', 'u3', 'u4', 'u5']
    const expense = fc
      .record({
        paidBy: fc.constantFrom(...people),
        amountCents: fc.integer({ min: 1, max: 1_000_000 }),
        members: fc.subarray(people, { minLength: 1 }),
        fxRate: fc.constantFrom(1, 1.1, 0.333, '1.23456789'),
      })
      .map(({ members, ...rest }): BalanceExpense => {
        const split = splitEqual(rest.amountCents, members)
        if (!split.ok) throw new Error('bad split')
        return {
          ...rest,
          splits: Object.entries(split.shares).map(([userId, shareCents]) => ({
            userId,
            shareCents,
          })),
        }
      })
    const settlement = fc.record({
      fromUser: fc.constantFrom(...people),
      toUser: fc.constantFrom(...people),
      amountCents: fc.integer({ min: 1, max: 100_000 }),
    })
    fc.assert(
      fc.property(fc.array(expense), fc.array(settlement), (expenses, settlements) => {
        const balances = computeBalances(expenses, settlements)
        expect(Object.values(balances).reduce((a, b) => a + b, 0)).toBe(0)
      }),
    )
  })
})
