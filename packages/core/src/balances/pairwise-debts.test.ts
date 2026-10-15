import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { computeBalances, pairwiseDebts, type BalanceExpense } from '../index'

describe('pairwiseDebts', () => {
  it('has each split person owe the payer their share', () => {
    const expenses: BalanceExpense[] = [
      {
        paidBy: 'a',
        amountCents: 900,
        splits: [
          { userId: 'a', shareCents: 300 },
          { userId: 'b', shareCents: 300 },
          { userId: 'c', shareCents: 300 },
        ],
      },
    ]
    expect(pairwiseDebts(expenses)).toEqual([
      { fromUser: 'b', toUser: 'a', amountCents: 300 },
      { fromUser: 'c', toUser: 'a', amountCents: 300 },
    ])
  })

  it('nets opposite debts between the same two people', () => {
    const expenses: BalanceExpense[] = [
      { paidBy: 'a', amountCents: 1000, splits: [{ userId: 'b', shareCents: 1000 }] },
      { paidBy: 'b', amountCents: 400, splits: [{ userId: 'a', shareCents: 400 }] },
    ]
    expect(pairwiseDebts(expenses)).toEqual([{ fromUser: 'b', toUser: 'a', amountCents: 600 }])
  })

  it('does not collapse chains (that is what simplifying is for)', () => {
    const expenses: BalanceExpense[] = [
      { paidBy: 'b', amountCents: 500, splits: [{ userId: 'a', shareCents: 500 }] },
      { paidBy: 'c', amountCents: 500, splits: [{ userId: 'b', shareCents: 500 }] },
    ]
    expect(pairwiseDebts(expenses)).toEqual([
      { fromUser: 'a', toUser: 'b', amountCents: 500 },
      { fromUser: 'b', toUser: 'c', amountCents: 500 },
    ])
  })

  it('applies settlements and skips deleted rows', () => {
    const expenses: BalanceExpense[] = [
      { paidBy: 'a', amountCents: 1000, splits: [{ userId: 'b', shareCents: 1000 }] },
      {
        paidBy: 'a',
        amountCents: 999,
        splits: [{ userId: 'b', shareCents: 999 }],
        deletedAt: '2026-01-01T00:00:00Z',
      },
    ]
    expect(
      pairwiseDebts(expenses, [
        { fromUser: 'b', toUser: 'a', amountCents: 1000 },
        { fromUser: 'b', toUser: 'a', amountCents: 50, deletedAt: '2026-01-01T00:00:00Z' },
      ]),
    ).toEqual([])
  })

  it('converts foreign expenses once into the group currency', () => {
    const expenses: BalanceExpense[] = [
      {
        paidBy: 'a',
        amountCents: 1000,
        currency: 'EUR',
        fxRate: '1.1',
        splits: [
          { userId: 'a', shareCents: 500 },
          { userId: 'b', shareCents: 500 },
        ],
      },
    ]
    expect(pairwiseDebts(expenses, [], { groupCurrency: 'USD' })).toEqual([
      { fromUser: 'b', toUser: 'a', amountCents: 550 },
    ])
  })

  it('adds up to the same net balances as computeBalances', () => {
    const user = fc.constantFrom('a', 'b', 'c', 'd')
    const expense = fc.record({
      paidBy: user,
      amountCents: fc.integer({ min: 1, max: 100_000 }),
      splits: fc.uniqueArray(fc.record({ userId: user, shareCents: fc.nat(1000) }), {
        minLength: 1,
        maxLength: 4,
        selector: (s) => s.userId,
      }),
    })
    fc.assert(
      fc.property(fc.array(expense, { maxLength: 8 }), (expenses) => {
        const net: Record<string, number> = {}
        for (const t of pairwiseDebts(expenses)) {
          net[t.fromUser] = (net[t.fromUser] ?? 0) - t.amountCents
          net[t.toUser] = (net[t.toUser] ?? 0) + t.amountCents
        }
        const expected = computeBalances(expenses)
        for (const id of new Set([...Object.keys(net), ...Object.keys(expected)])) {
          expect(net[id] ?? 0).toBe(expected[id] ?? 0)
        }
      }),
    )
  })
})
