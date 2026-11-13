import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  computeBalances,
  expenseEffect,
  pairwiseDebts,
  splitEqual,
  type BalanceExpense,
} from '../index'

// The same cases run against the `group_balances` view in
// supabase/tests/19_expense_entry.test.sql; the pairwise cases also run against private.pairwise_debts in
// supabase/tests/23_payments.test.sql.
const equalThree = [
  { userId: 'ava', shareCents: 3000 },
  { userId: 'ben', shareCents: 3000 },
  { userId: 'cleo', shareCents: 3000 },
]

describe('multiple payers', () => {
  const dinner: BalanceExpense = {
    paidBy: 'ava',
    payers: [
      { userId: 'ava', paidCents: 6000 },
      { userId: 'ben', paidCents: 3000 },
    ],
    amountCents: 9000,
    splits: equalThree,
  }

  it('credits each payer what they paid', () => {
    // 90 paid 60 by Ava and 30 by Ben, split three ways.
    expect(computeBalances([dinner])).toEqual({ ava: 3000, ben: 0, cleo: -3000 })
  })

  it('has only the people behind pay the people ahead', () => {
    expect(pairwiseDebts([dinner])).toEqual([
      { fromUser: 'cleo', toUser: 'ava', amountCents: 3000 },
    ])
  })

  it('spreads the converted total over the payers by what they paid', () => {
    const expense: BalanceExpense = {
      paidBy: 'b',
      payers: [
        { userId: 'a', paidCents: 333 },
        { userId: 'b', paidCents: 667 },
      ],
      amountCents: 1000,
      fxRate: '1.1',
      splits: [
        { userId: 'a', shareCents: 334 },
        { userId: 'b', shareCents: 333 },
        { userId: 'c', shareCents: 333 },
      ],
    }
    // 1000 at 1.1 is 1100. Payers: 366.3 and 733.7, so 366 and 734. Split: 367.4, 366.3,
    // 366.3, so 368, 366, 366.
    expect(expenseEffect(expense)).toEqual({ a: 366 - 368, b: 734 - 366, c: -366 })
    expect(computeBalances([expense])).toEqual({ a: -2, b: 368, c: -366 })
    const debts = pairwiseDebts([expense])
    expect(debts).toEqual([
      { fromUser: 'c', toUser: 'b', amountCents: 366 },
      { fromUser: 'a', toUser: 'b', amountCents: 2 },
    ])
  })

  it('splits a debtor over several creditors by what they are owed', () => {
    const expense: BalanceExpense = {
      paidBy: 'a',
      payers: [
        { userId: 'a', paidCents: 500 },
        { userId: 'b', paidCents: 500 },
      ],
      amountCents: 1000,
      splits: [
        { userId: 'c', shareCents: 500 },
        { userId: 'd', shareCents: 500 },
      ],
    }
    expect(pairwiseDebts([expense])).toEqual([
      { fromUser: 'c', toUser: 'a', amountCents: 250 },
      { fromUser: 'c', toUser: 'b', amountCents: 250 },
      { fromUser: 'd', toUser: 'a', amountCents: 250 },
      { fromUser: 'd', toUser: 'b', amountCents: 250 },
    ])
  })

  it('ignores an expense whose payers paid nothing', () => {
    expect(
      expenseEffect({ paidBy: 'a', payers: [], amountCents: 100, splits: equalThree }),
    ).toBeNull()
  })
})

describe('refunds', () => {
  it('debits whoever received the money and credits the split', () => {
    // A 40 refund received by Ava, split between Ava and Ben.
    const refund: BalanceExpense = {
      paidBy: 'ava',
      isRefund: true,
      amountCents: 4000,
      splits: [
        { userId: 'ava', shareCents: 2000 },
        { userId: 'ben', shareCents: 2000 },
      ],
    }
    expect(computeBalances([refund])).toEqual({ ava: -2000, ben: 2000 })
    expect(pairwiseDebts([refund])).toEqual([{ fromUser: 'ava', toUser: 'ben', amountCents: 2000 }])
  })

  it('reduces what someone owes for the original expense', () => {
    const dinner: BalanceExpense = {
      paidBy: 'ava',
      amountCents: 10000,
      splits: [
        { userId: 'ava', shareCents: 5000 },
        { userId: 'ben', shareCents: 5000 },
      ],
    }
    const refund: BalanceExpense = {
      paidBy: 'ava',
      isRefund: true,
      amountCents: 4000,
      splits: [
        { userId: 'ava', shareCents: 2000 },
        { userId: 'ben', shareCents: 2000 },
      ],
    }
    expect(computeBalances([dinner, refund])).toEqual({ ava: 3000, ben: -3000 })
    expect(pairwiseDebts([dinner, refund])).toEqual([
      { fromUser: 'ben', toUser: 'ava', amountCents: 3000 },
    ])
  })
})

describe('pairwise debts with several payers', () => {
  it('always sums per person to the net balances', () => {
    const people = ['u1', 'u2', 'u3', 'u4', 'u5']
    const expense = fc
      .record({
        amountCents: fc.integer({ min: 1, max: 1_000_000 }),
        members: fc.subarray(people, { minLength: 1 }),
        payers: fc.subarray(people, { minLength: 1 }),
        isRefund: fc.boolean(),
        fxRate: fc.constantFrom(1, 1.1, 0.333, '1.23456789'),
      })
      .map(({ members, payers, ...rest }): BalanceExpense => {
        const split = splitEqual(rest.amountCents, members)
        const paid = splitEqual(rest.amountCents, payers)
        if (!split.ok || !paid.ok) throw new Error('bad split')
        return {
          ...rest,
          paidBy: payers[0]!,
          payers: Object.entries(paid.shares).map(([userId, paidCents]) => ({ userId, paidCents })),
          splits: Object.entries(split.shares).map(([userId, shareCents]) => ({
            userId,
            shareCents,
          })),
        }
      })
    fc.assert(
      fc.property(fc.array(expense, { maxLength: 8 }), (expenses) => {
        const net = computeBalances(expenses)
        expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0)
        const fromDebts: Record<string, number> = {}
        for (const d of pairwiseDebts(expenses)) {
          fromDebts[d.fromUser] = (fromDebts[d.fromUser] ?? 0) - d.amountCents
          fromDebts[d.toUser] = (fromDebts[d.toUser] ?? 0) + d.amountCents
        }
        for (const [id, cents] of Object.entries(net)) expect(fromDebts[id] ?? 0).toBe(cents)
      }),
    )
  })
})
