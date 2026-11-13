import { convert } from '../currency'
import { allocate, compareIds } from '../money/allocate'
import {
  expenseEffect,
  type BalanceExpense,
  type BalanceOptions,
  type BalanceSettlement,
} from './balances'
import type { Transfer } from './simplify'

/**
 * Who pays whom inside one expense, from its effect on each person: everyone who comes out
 * behind pays the people who come out ahead. Debtors go in id order and each one is spread over
 * the creditors in proportion to what those creditors are still owed (largest remainder), so
 * both sides add up exactly. With one payer this is simply "everyone owes the payer their share".
 */
function expenseTransfers(effect: Readonly<Record<string, number>>): Transfer[] {
  const ids = Object.keys(effect).sort(compareIds)
  const creditors = new Map<string, bigint>()
  for (const id of ids) if (effect[id]! > 0) creditors.set(id, BigInt(effect[id]!))
  const transfers: Transfer[] = []
  for (const debtor of ids) {
    const owes = -effect[debtor]!
    if (owes <= 0) continue
    const open = new Map([...creditors].filter(([, left]) => left > 0n))
    for (const [creditor, cents] of Object.entries(allocate(owes, open))) {
      if (cents === 0) continue
      creditors.set(creditor, creditors.get(creditor)! - BigInt(cents))
      transfers.push({ fromUser: debtor, toUser: creditor, amountCents: cents })
    }
  }
  return transfers
}

/**
 * What one expense does between two people, from its effect on everyone (`expenseEffect`):
 * positive when `other` comes out owing `person`, negative when `person` owes `other`. Uses the
 * same spread as `pairwiseDebts`, so summing it over a group's expenses and payments gives that
 * pair's debt there.
 */
export function pairEffect(
  effect: Readonly<Record<string, number>>,
  person: string,
  other: string,
): number {
  let net = 0
  for (const t of expenseTransfers(effect)) {
    if (t.fromUser === other && t.toUser === person) net += t.amountCents
    else if (t.fromUser === person && t.toUser === other) net -= t.amountCents
  }
  return net
}

/**
 * Who owes whom without simplification: inside every expense the people who came out behind
 * owe the people who came out ahead (with one payer: everyone owes the payer their part),
 * settlements pay those debts down, and each pair is netted to a single transfer.
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

  for (const expense of expenses) {
    const effect = expenseEffect(expense, options)
    if (!effect) continue
    for (const t of expenseTransfers(effect)) addDebt(t.fromUser, t.toUser, t.amountCents)
  }

  for (const settlement of settlements) {
    if (settlement.deletedAt) continue
    const amount = convert(settlement.amountCents, settlement.fxRate ?? 1, {
      from: settlement.currency,
      to: options.groupCurrency,
    })
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
