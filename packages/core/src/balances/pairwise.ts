import { convert } from '../currency'
import { allocate, compareIds } from '../money/allocate'
import type { BalanceExpense, BalanceOptions, BalanceSettlement } from './balances'
import type { Transfer } from './simplify'

/**
 * Who owes whom without simplification: every split person owes the payer their part of each
 * expense, settlements pay those debts down, and each pair is netted to a single transfer.
 *
 * Uses the same per-expense conversion and largest remainder spread as `computeBalances`, so
 * summing the transfers per person gives exactly the net balances. Ordered by amount (largest
 * first), then by user ids.
 */
export function pairwiseDebts(
  expenses: readonly BalanceExpense[],
  settlements: readonly BalanceSettlement[] = [],
  options: BalanceOptions = {},
): Transfer[] {
  // owed.get("a|b") > 0 means a owes b, with a < b by id; negative means b owes a.
  const owed = new Map<string, number>()
  const addDebt = (from: string, to: string, cents: number) => {
    if (from === to || cents === 0) return
    const [lo, hi, sign] = compareIds(from, to) < 0 ? [from, to, 1] : [to, from, -1]
    const key = `${lo}|${hi}`
    owed.set(key, (owed.get(key) ?? 0) + sign * cents)
  }
  const toGroup = (amount: number, fxRate: number | string | undefined, currency?: string) =>
    convert(amount, fxRate ?? 1, { from: currency, to: options.groupCurrency })

  for (const expense of expenses) {
    if (expense.deletedAt) continue
    const weights = new Map<string, bigint>()
    for (const split of expense.splits) {
      weights.set(split.userId, (weights.get(split.userId) ?? 0n) + BigInt(split.shareCents))
    }
    let weightSum = 0n
    for (const w of weights.values()) weightSum += w
    if (weightSum === 0n) continue

    const total = toGroup(expense.amountCents, expense.fxRate, expense.currency)
    for (const [userId, share] of Object.entries(allocate(total, weights))) {
      addDebt(userId, expense.paidBy, share)
    }
  }

  for (const settlement of settlements) {
    if (settlement.deletedAt) continue
    const amount = toGroup(settlement.amountCents, settlement.fxRate, settlement.currency)
    // Paying someone reduces what you owe them.
    addDebt(settlement.toUser, settlement.fromUser, amount)
  }

  const transfers: Transfer[] = []
  for (const [key, cents] of owed) {
    if (cents === 0) continue
    const [lo, hi] = key.split('|') as [string, string]
    transfers.push(
      cents > 0
        ? { fromUser: lo, toUser: hi, amountCents: cents }
        : { fromUser: hi, toUser: lo, amountCents: -cents },
    )
  }
  return transfers.sort(
    (a, b) =>
      b.amountCents - a.amountCents ||
      compareIds(a.fromUser, b.fromUser) ||
      compareIds(a.toUser, b.toUser),
  )
}
