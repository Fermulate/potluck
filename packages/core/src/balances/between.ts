import type { BalanceExpense, BalanceSettlement } from './balances'

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
