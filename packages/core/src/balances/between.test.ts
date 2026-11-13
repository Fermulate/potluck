import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  expenseInvolvesBoth,
  netBetween,
  pairwiseDebts,
  settlementBetween,
  type BalanceExpense,
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

// Same ledger as supabase/tests/27_placeholder_members.test.sql: Groceries 30 paid by Ava for
// Ava, Ben and Sam; Taxi 12 paid by Sam for Ava and Sam; Ava pays Sam 3.
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

describe('netBetween', () => {
  it('nets what Sam owes Ava across the expenses and the payment', () => {
    // Groceries: Sam owes Ava 10. Taxi: Ava owes Sam 6. Ava paid Sam 3: Sam owes Ava 7.
    expect(netBetween([groceries, taxi], [payment], AVA, SAM)).toBe(700)
    expect(netBetween([groceries, taxi], [payment], SAM, AVA)).toBe(-700)
    expect(netBetween([groceries, taxi], [payment], AVA, BEN)).toBe(1000)
    expect(netBetween([groceries, taxi], [payment], AVA, AVA)).toBe(0)
  })

  it('ignores deleted rows', () => {
    expect(netBetween([{ ...groceries, deletedAt: '2026-11-01' }], [], AVA, SAM)).toBe(0)
  })

  it('mirrors the other side and matches their pairwise debt', () => {
    const person = fc.constantFrom(AVA, BEN, SAM)
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            paidBy: person,
            amount: fc.integer({ min: 1, max: 100_000 }),
            people: fc.uniqueArray(person, { minLength: 1, maxLength: 3 }),
          }),
          { maxLength: 6 },
        ),
        (rows) => {
          const expenses = rows.map((r) => equal(r.paidBy, r.amount, r.people))
          const ab = netBetween(expenses, [], AVA, BEN)
          expect(netBetween(expenses, [], BEN, AVA)).toBe(ab === 0 ? 0 : -ab)
          const pair = pairwiseDebts(expenses).find(
            (t) =>
              (t.fromUser === AVA && t.toUser === BEN) || (t.fromUser === BEN && t.toUser === AVA),
          )
          expect(Math.abs(ab)).toBe(pair?.amountCents ?? 0)
        },
      ),
    )
  })
})
