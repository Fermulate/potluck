import { compareIds } from '../money/allocate'

export interface Transfer {
  fromUser: string
  toUser: string
  amountCents: number
}

/** Pick the entry with the largest amount, ties going to the smallest user id. */
function pickLargest(entries: Map<string, number>): [string, number] {
  let best: [string, number] | undefined
  for (const entry of entries) {
    if (
      !best ||
      entry[1] > best[1] ||
      (entry[1] === best[1] && compareIds(entry[0], best[0]) < 0)
    ) {
      best = entry
    }
  }
  return best!
}

/**
 * Turn net balances (positive = is owed) into a short list of payments.
 *
 * Greedy, same as the SQL `simplified_debts`: repeatedly match the largest creditor with the
 * largest debtor (ties broken by ascending user id) and transfer the smaller of the two amounts.
 * Produces at most n - 1 transfers. Throws if the balances do not sum to zero.
 */
export function simplifyDebts(balances: Readonly<Record<string, number>>): Transfer[] {
  const creditors = new Map<string, number>()
  const debtors = new Map<string, number>()
  let sum = 0
  for (const [userId, cents] of Object.entries(balances)) {
    sum += cents
    if (cents > 0) creditors.set(userId, cents)
    else if (cents < 0) debtors.set(userId, -cents)
  }
  if (sum !== 0) throw new RangeError(`balances must sum to zero, got ${sum}`)

  const transfers: Transfer[] = []
  while (creditors.size > 0 && debtors.size > 0) {
    const [toUser, owed] = pickLargest(creditors)
    const [fromUser, owes] = pickLargest(debtors)
    const amountCents = Math.min(owed, owes)
    transfers.push({ fromUser, toUser, amountCents })

    if (owed === amountCents) creditors.delete(toUser)
    else creditors.set(toUser, owed - amountCents)
    if (owes === amountCents) debtors.delete(fromUser)
    else debtors.set(fromUser, owes - amountCents)
  }
  return transfers
}
