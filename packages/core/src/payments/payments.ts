import { can, type GroupRole } from '../roles'
import type { Transfer } from '../balances'

/** Largest amount one payment may carry, as in the `settlements` check constraint. */
export const MAX_PAYMENT_CENTS = 100_000_000_000

export type PaymentProblem =
  'invalid_amount' | 'invalid_parties' | 'not_a_party' | 'member_not_in_group'

export interface PaymentCheck {
  viewerId: string
  viewerRole: GroupRole | null | undefined
  fromUser: string | null | undefined
  toUser: string | null | undefined
  amountCents: number | null | undefined
  /** Current members of the group. */
  memberIds: readonly string[]
  /**
   * Members not on Potluck yet (ADR 19). Anyone in the group may record a payment one side of
   * which is one of them, since they cannot record it themselves.
   */
  placeholderIds?: readonly string[]
}

/**
 * The first reason the server would refuse this payment, in the same order as
 * `private.check_payment`, or null when it would be recorded. The codes are the server's.
 */
export function paymentProblem(p: PaymentCheck): PaymentProblem | null {
  if (
    p.amountCents == null ||
    !Number.isSafeInteger(p.amountCents) ||
    p.amountCents <= 0 ||
    p.amountCents > MAX_PAYMENT_CENTS
  ) {
    return 'invalid_amount'
  }
  if (!p.fromUser || !p.toUser || p.fromUser === p.toUser) return 'invalid_parties'
  const isParty =
    p.viewerId === p.fromUser ||
    p.viewerId === p.toUser ||
    !!p.placeholderIds?.some((id) => id === p.fromUser || id === p.toUser)
  if (!can(p.viewerRole, 'settlement.record', { isParty })) return 'not_a_party'
  if (!p.memberIds.includes(p.fromUser) || !p.memberIds.includes(p.toUser)) {
    return 'member_not_in_group'
  }
  return null
}

/**
 * The payments "Settle everything" records in a group: every debt the viewer is in, between
 * people still in the group. Mirrors `public.settle_all`.
 */
export function settleAllPayments(
  debts: readonly Transfer[],
  viewerId: string,
  memberIds: readonly string[],
): Transfer[] {
  return debts.filter(
    (d) =>
      (d.fromUser === viewerId || d.toUser === viewerId) &&
      memberIds.includes(d.fromUser) &&
      memberIds.includes(d.toUser),
  )
}

export interface FriendBalanceRow {
  friendId: string
  groupId: string
  currency: string
  /** Positive: the friend owes the viewer. */
  netCents: number
  archived: boolean
}

export interface FriendTotal {
  friendId: string
  /** Net per currency, positive when the friend owes the viewer; zero totals are left out. */
  byCurrency: { currency: string; netCents: number }[]
  /** Open groups with a balance, which "Settle up" pays off one payment each. */
  settleable: FriendBalanceRow[]
  /** Archived groups with a balance: read only, so they are not settled. */
  archived: FriendBalanceRow[]
}

/**
 * Adds up `friend_balances` rows per friend and currency, the way the friends list shows them
 * ("$12.45 and EUR 8.72"). Rows with a zero balance are ignored.
 */
export function friendTotals(rows: readonly FriendBalanceRow[]): Map<string, FriendTotal> {
  const totals = new Map<string, FriendTotal>()
  for (const row of rows) {
    if (row.netCents === 0) continue
    let total = totals.get(row.friendId)
    if (!total) {
      total = { friendId: row.friendId, byCurrency: [], settleable: [], archived: [] }
      totals.set(row.friendId, total)
    }
    ;(row.archived ? total.archived : total.settleable).push(row)
    const entry = total.byCurrency.find((c) => c.currency === row.currency)
    if (entry) entry.netCents += row.netCents
    else total.byCurrency.push({ currency: row.currency, netCents: row.netCents })
  }
  for (const total of totals.values()) {
    total.byCurrency = total.byCurrency
      .filter((c) => c.netCents !== 0)
      .sort(
        (a, b) =>
          Math.abs(b.netCents) - Math.abs(a.netCents) || a.currency.localeCompare(b.currency),
      )
  }
  return totals
}
