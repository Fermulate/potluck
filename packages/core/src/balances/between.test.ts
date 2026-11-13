import { describe, expect, it } from 'vitest'
import { expenseInvolvesBoth, settlementBetween, type BalanceExpense } from '../index'

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
