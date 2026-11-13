import type { BalanceExpense, BalanceOptions, BalanceSettlement } from './balances'
import { pairwiseDebts } from './pairwise'

/** Whether both people paid for or have a share in `expense`. */
export function expenseInvolvesBoth(expense: BalanceExpense, a: string, b: string): boolean {
  if (a === b) return false
  const people = new Set<string>()
  for (const p of expense.payers ?? [{ userId: expense.paidBy }]) people.add(p.userId)
  for (const s of expense.splits) people.add(s.userId)
  return people.has(a) && people.has(b)
}

/** Whether `settlement` is a payment between the two of them, either way. */
export function settlementBetween(settlement: BalanceSettlement, a: string, b: string): boolean {
  return (
    (settlement.fromUser === a && settlement.toUser === b) ||
    (settlement.fromUser === b && settlement.toUser === a)
  )
}

/**
 * Where `me` stands with `other` inside one group, in the group currency: positive means
 * `other` owes `me`. It is their pair from `pairwiseDebts` (every expense, not just the ones
 * both are in, because a payment between them can settle anything), so a friend page and the
 * group's "who owes whom" with simplify off never disagree.
 */
export function netBetween(
  expenses: readonly BalanceExpense[],
  settlements: readonly BalanceSettlement[],
  me: string,
  other: string,
  options: BalanceOptions = {},
): number {
  if (me === other) return 0
  let net = 0
  for (const t of pairwiseDebts(expenses, settlements, options)) {
    if (t.fromUser === other && t.toUser === me) net += t.amountCents
    else if (t.fromUser === me && t.toUser === other) net -= t.amountCents
  }
  return net
}
