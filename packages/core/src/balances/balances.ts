import { convert } from '../currency'
import { allocate, type Shares } from '../money/allocate'

export interface BalanceSplit {
  userId: string
  shareCents: number
}

export interface BalanceExpense {
  paidBy: string
  /** In the expense currency's minor units. */
  amountCents: number
  /** Expense currency, only needed when its minor units differ from the group currency. */
  currency?: string
  /** Rate into the group currency (`expenses.fx_rate`). Defaults to 1. */
  fxRate?: number | string
  splits: readonly BalanceSplit[]
  deletedAt?: string | null
}

export interface BalanceSettlement {
  fromUser: string
  toUser: string
  amountCents: number
  currency?: string
  fxRate?: number | string
  deletedAt?: string | null
}

export interface BalanceOptions {
  /** Group currency, used for minor unit conversion together with `currency` on each row. */
  groupCurrency?: string
}

/**
 * Net balance per user in the group currency: positive means the group owes them.
 *
 * Expenses: the payer is credited the converted amount; that converted amount is then divided
 * across the splits in proportion to `shareCents` (largest remainder, ties by user id), so a
 * foreign currency expense still nets to exactly zero. Settlements: `fromUser` paid `toUser`,
 * so `fromUser` goes up and `toUser` goes down. Soft-deleted rows are ignored.
 *
 * Every user that appears in any row gets an entry, including those at zero.
 */
export function computeBalances(
  expenses: readonly BalanceExpense[],
  settlements: readonly BalanceSettlement[] = [],
  options: BalanceOptions = {},
): Shares {
  const net: Shares = {}
  const add = (userId: string, cents: number) => {
    net[userId] = (net[userId] ?? 0) + cents
  }
  const toGroup = (amount: number, fxRate: number | string | undefined, currency?: string) =>
    convert(amount, fxRate ?? 1, { from: currency, to: options.groupCurrency })

  for (const expense of expenses) {
    if (expense.deletedAt) continue
    const total = toGroup(expense.amountCents, expense.fxRate, expense.currency)
    const weights = new Map<string, bigint>()
    for (const split of expense.splits) {
      weights.set(split.userId, (weights.get(split.userId) ?? 0n) + BigInt(split.shareCents))
    }
    let weightSum = 0n
    for (const w of weights.values()) weightSum += w
    if (weightSum === 0n) continue

    add(expense.paidBy, total)
    for (const [userId, share] of Object.entries(allocate(total, weights))) add(userId, -share)
  }

  for (const settlement of settlements) {
    if (settlement.deletedAt) continue
    const amount = toGroup(settlement.amountCents, settlement.fxRate, settlement.currency)
    add(settlement.fromUser, amount)
    add(settlement.toUser, -amount)
  }

  return net
}
