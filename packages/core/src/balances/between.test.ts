import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  expenseBetween,
  expenseInvolvesBoth,
  pairwiseDebts,
  settlementBetween,
  type BalanceExpense,
  type BalanceSettlement,
} from '../index'

const AVA = 'a0000000-0000-4000-8000-000000000001'
const BEN = 'b0000000-0000-4000-8000-000000000002'
const SAM = 'c0000000-0000-4000-8000-000000000003'

const equal = (paidBy: string, amountCents: number, people: string[]): BalanceExpense => {
  const base = Math.floor(amountCents / people.length)
  const extra = amountCents - base * people.length
  return {
    paidBy,
    amountCents,
    splits: people.map((userId, i) => ({ userId, shareCents: base + (i < extra ? 1 : 0) })),
  }
}

// Groceries 30 paid by Ava for Ava, Ben and Sam; Taxi 12 paid by Sam for Ava and Sam; Ava pays Sam 3.
const groceries = equal(AVA, 3000, [AVA, BEN, SAM])
const taxi = equal(SAM, 1200, [AVA, SAM])
const payment = { fromUser: AVA, toUser: SAM, amountCents: 300 }

describe('expenseInvolvesBoth', () => {
  it('is true when both paid for or share the expense', () => {
    expect(expenseInvolvesBoth(groceries, AVA, SAM)).toBe(true)
    expect(expenseInvolvesBoth(taxi, SAM, AVA)).toBe(true)
    expect(expenseInvolvesBoth(taxi, BEN, AVA)).toBe(false)
    expect(expenseInvolvesBoth(taxi, AVA, AVA)).toBe(false)
  })

  it('reads every payer when there are several', () => {
    const shared: BalanceExpense = {
      ...equal(AVA, 900, [AVA]),
      payers: [
        { userId: AVA, paidCents: 600 },
        { userId: BEN, paidCents: 300 },
      ],
    }
    expect(expenseInvolvesBoth(shared, AVA, BEN)).toBe(true)
  })
})

describe('settlementBetween', () => {
  it('matches a payment either way', () => {
    expect(settlementBetween(payment, AVA, SAM)).toBe(true)
    expect(settlementBetween(payment, SAM, AVA)).toBe(true)
    expect(settlementBetween(payment, AVA, BEN)).toBe(false)
  })
})

describe('expenseBetween', () => {
  // Short ids sort in name order, so the spread between creditors is easy to follow.
  const [me, jules, owen, pat] = ['a', 'b', 'c', 'd'] as const

  it('is what the other person owes on an expense the viewer paid, not the viewer net', () => {
    // Concert, 200.00 paid by me, 80% Jules and 20% Owen: I am up 200, Jules owes me 160.
    const concert: BalanceExpense = {
      paidBy: me,
      amountCents: 20000,
      splits: [
        { userId: jules, shareCents: 16000 },
        { userId: owen, shareCents: 4000 },
      ],
    }
    expect(expenseBetween(concert, me, jules)).toBe(16000)
    expect(expenseBetween(concert, jules, me)).toBe(-16000)
    expect(expenseBetween(concert, me, owen)).toBe(4000)
    // Jules and Owen both owe me: nothing passes between them.
    expect(expenseBetween(concert, jules, owen)).toBe(0)
  })

  it('is 0 between two people who both owe whoever paid, and null when one is not in it', () => {
    // Rent, 1,500.00 paid by Owen, split three ways with Pat and Jules.
    const rent: BalanceExpense = {
      paidBy: owen,
      amountCents: 150000,
      splits: [
        { userId: owen, shareCents: 50000 },
        { userId: pat, shareCents: 50000 },
        { userId: jules, shareCents: 50000 },
      ],
    }
    expect(expenseBetween(rent, pat, jules)).toBe(0)
    expect(expenseBetween(rent, pat, owen)).toBe(-50000)
    expect(expenseBetween(rent, me, owen)).toBeNull()
    expect(expenseBetween({ ...rent, deletedAt: '2026-01-01T00:00:00Z' }, pat, owen)).toBeNull()
  })

  it('spreads each debtor over several payers by what they are still owed', () => {
    // 12.00 paid 8.00 by me and 4.00 by Jules, 3.00 each: I am up 5.00, Jules 1.00.
    const dinner: BalanceExpense = {
      paidBy: me,
      amountCents: 1200,
      payers: [
        { userId: me, paidCents: 800 },
        { userId: jules, paidCents: 400 },
      ],
      splits: [me, jules, owen, pat].map((userId) => ({ userId, shareCents: 300 })),
    }
    expect(expenseBetween(dinner, me, owen)).toBe(250)
    expect(expenseBetween(dinner, jules, owen)).toBe(50)
    expect(expenseBetween(dinner, me, pat)).toBe(250)
    expect(expenseBetween(dinner, jules, pat)).toBe(50)
    expect(expenseBetween(dinner, me, jules)).toBe(0)
  })

  it('flips for a refund and converts a foreign expense once into the group currency', () => {
    const refund: BalanceExpense = {
      paidBy: me,
      isRefund: true,
      amountCents: 1000,
      splits: [{ userId: jules, shareCents: 1000 }],
    }
    expect(expenseBetween(refund, me, jules)).toBe(-1000)

    const taxi: BalanceExpense = {
      paidBy: me,
      amountCents: 1000,
      currency: 'EUR',
      fxRate: '1.100000000000',
      splits: [
        { userId: me, shareCents: 500 },
        { userId: jules, shareCents: 500 },
      ],
    }
    expect(expenseBetween(taxi, me, jules, { groupCurrency: 'USD' })).toBe(550)
  })

  it('adds up, with the payments between them, to what pairwiseDebts says they owe', () => {
    const user = fc.constantFrom('a', 'b', 'c', 'd')
    const expense = fc.record({
      paidBy: user,
      amountCents: fc.integer({ min: 1, max: 100_000 }),
      isRefund: fc.boolean(),
      splits: fc.uniqueArray(fc.record({ userId: user, shareCents: fc.nat(1000) }), {
        minLength: 1,
        maxLength: 4,
        selector: (s) => s.userId,
      }),
    })
    const payment = fc.record({
      fromUser: user,
      toUser: user,
      amountCents: fc.integer({ min: 1, max: 10_000 }),
    })
    fc.assert(
      fc.property(
        fc.array(expense, { maxLength: 8 }),
        fc.array(payment, { maxLength: 4 }),
        user,
        user,
        (expenses: BalanceExpense[], payments: BalanceSettlement[], a, b) => {
          fc.pre(a !== b)
          let rows = 0
          for (const e of expenses) rows += expenseBetween(e, a, b) ?? 0
          for (const p of payments) {
            if (p.fromUser === a && p.toUser === b) rows += p.amountCents
            if (p.fromUser === b && p.toUser === a) rows -= p.amountCents
          }
          let owed = 0
          for (const t of pairwiseDebts(expenses, payments)) {
            if (t.fromUser === b && t.toUser === a) owed += t.amountCents
            if (t.fromUser === a && t.toUser === b) owed -= t.amountCents
          }
          expect(rows).toBe(owed)
        },
      ),
    )
  })
})
