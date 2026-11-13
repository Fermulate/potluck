import { convert } from '../currency'
import { allocate, type Shares } from '../money/allocate'

export interface BalanceSplit {
  userId: string
  shareCents: number
}

export interface BalancePayer {
  userId: string
  paidCents: number
}

export interface BalanceExpense {
  /** The one payer. Ignored when `payers` is given. */
  paidBy: string
  /** Everyone who paid and how much, in the expense currency (`expense_payers`). */
  payers?: readonly BalancePayer[]
  /**
   * Money that came back (`expenses.is_refund`): the payers received it, so the signs flip and
   * the people in the split are credited their share.
   */
  isRefund?: boolean
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

function weightsOf(rows: readonly { userId: string; cents: number }[]): Map<string, bigint> {
  const weights = new Map<string, bigint>()
  for (const row of rows) {
    weights.set(row.userId, (weights.get(row.userId) ?? 0n) + BigInt(row.cents))
  }
  return weights
}

const total = (weights: ReadonlyMap<string, bigint>) => {
  let sum = 0n
  for (const w of weights.values()) sum += w
  return sum
}

/**
 * What one expense does to each person's balance in the group currency (positive = is owed),
 * or null when it moves nothing (deleted, or nobody has a share).
 *
 * The amount is converted once. The converted total is spread across the payers in proportion
 * to what each paid, and across the split in proportion to each share (largest remainder, ties
 * by user id, both times), so every expense nets to exactly zero. A refund flips both signs.
 * Same rule as the `group_balances` view.
 */
export function expenseEffect(
  expense: BalanceExpense,
  options: BalanceOptions = {},
): Shares | null {
  if (expense.deletedAt) return null
  const splitWeights = weightsOf(
    expense.splits.map((s) => ({ userId: s.userId, cents: s.shareCents })),
  )
  const payerWeights = weightsOf(
    (expense.payers ?? [{ userId: expense.paidBy, paidCents: expense.amountCents }]).map((p) => ({
      userId: p.userId,
      cents: p.paidCents,
    })),
  )
  if (total(splitWeights) === 0n || total(payerWeights) === 0n) return null

  const converted = convert(expense.amountCents, expense.fxRate ?? 1, {
    from: expense.currency,
    to: options.groupCurrency,
  })
  const sign = expense.isRefund ? -1 : 1
  const effect: Shares = {}
  const add = (userId: string, cents: number) => {
    effect[userId] = (effect[userId] ?? 0) + cents
  }
  for (const [userId, credit] of Object.entries(allocate(converted, payerWeights))) {
    add(userId, sign * credit)
  }
  for (const [userId, share] of Object.entries(allocate(converted, splitWeights))) {
    add(userId, -sign * share)
  }
  return effect
}

/**
 * Net balance per user in the group currency: positive means the group owes them.
 *
 * Expenses: see `expenseEffect` (payers credited, the split debited, both from one converted
 * total). Settlements: `fromUser` paid `toUser`, so `fromUser` goes up and `toUser` goes down.
 * Soft-deleted rows are ignored.
 *
 * Every user that appears in any counted row gets an entry, including those at zero.
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

  for (const expense of expenses) {
    const effect = expenseEffect(expense, options)
    if (!effect) continue
    for (const [userId, cents] of Object.entries(effect)) add(userId, cents)
  }

  for (const settlement of settlements) {
    if (settlement.deletedAt) continue
    const amount = convert(settlement.amountCents, settlement.fxRate ?? 1, {
      from: settlement.currency,
      to: options.groupCurrency,
    })
    add(settlement.fromUser, amount)
    add(settlement.toUser, -amount)
  }

  return net
}
