import {
  expenseEffect,
  type BalanceExpense,
  type BalanceOptions,
  type BalanceSettlement,
} from './balances'
import { pairEffect } from './pairwise'

/** Whether both people paid for or have a share in `expense`. */
export function expenseInvolvesBoth(expense: BalanceExpense, a: string, b: string): boolean {
  if (a === b) return false
  const people = new Set<string>()
  for (const p of expense.payers ?? [{ userId: expense.paidBy }]) people.add(p.userId)
  for (const s of expense.splits) people.add(s.userId)
  return people.has(a) && people.has(b)
}

/**
 * What one expense leaves between two people, in the group currency: positive when `other`
 * owes `person`, negative when `person` owes `other`, 0 when both are in it but nothing passes
 * between them (say both owe a third person who paid), and null when it is not theirs to share
 * (one of them is not in it, or it is deleted).
 *
 * This is one expense's step of `pairwiseDebts` (`private.pairwise_debts` in SQL): summed over a
 * group's expenses, plus the payments between the two, it gives exactly what they owe each other
 * there without simplifying. Friend pages and the one-friend export show it per row.
 */
export function expenseBetween(
  expense: BalanceExpense,
  person: string,
  other: string,
  options: BalanceOptions = {},
): number | null {
  if (!expenseInvolvesBoth(expense, person, other)) return null
  const effect = expenseEffect(expense, options)
  if (!effect) return null
  return pairEffect(effect, person, other)
}

/** Whether `settlement` is a payment between the two of them, either way. */
export function settlementBetween(settlement: BalanceSettlement, a: string, b: string): boolean {
  return (
    (settlement.fromUser === a && settlement.toUser === b) ||
    (settlement.fromUser === b && settlement.toUser === a)
  )
}
