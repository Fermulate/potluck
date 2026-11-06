import type { ExpenseSplitInput, ExpenseWithSplits, SplitTypeValue } from '@potluck/api'
import {
  roundedUp,
  splitEqual,
  splitExact,
  splitItemized,
  splitPercent,
  splitShares,
  type SplitResult,
} from '@potluck/core'
import { t } from '@potluck/i18n'

/** The reason a split preview failed, as a sentence, or null when it is fine. */
export function splitErrorText(result: SplitResult): string | null {
  if (result.ok) return null
  return t(`errors.split.${result.error.code}`)
}

/** Percentages are edited in basis points (1% = 100) so they always add up to exactly 100%. */
export const FULL = 10_000

export interface ItemDraft {
  id: string
  name: string
  amountCents: number | null
  userIds: string[]
}

export interface SplitDraft {
  mode: SplitTypeValue
  /** People in the split, in member order. Used by every mode except itemized. */
  participants: string[]
  /** Exact amounts in minor units. Missing means empty. */
  exact: Record<string, number | null>
  /** Basis points per participant, always summing to FULL. */
  percent: Record<string, number>
  /** Share counts per participant. */
  shares: Record<string, number>
  items: ItemDraft[]
  taxCents: number | null
  tipCents: number | null
  /** A tip shortcut that was picked; the tip follows the subtotal until a tip is typed. */
  tipPercent: number | null
}

let itemSeq = 0
export function newItem(userIds: string[] = []): ItemDraft {
  itemSeq += 1
  return { id: `item-${itemSeq}`, name: '', amountCents: null, userIds }
}

/** Splits `FULL` evenly; the leftover basis points go to the first people. */
export function evenPercent(ids: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {}
  if (ids.length === 0) return out
  const base = Math.floor(FULL / ids.length)
  let left = FULL - base * ids.length
  for (const id of ids) {
    out[id] = base + (left > 0 ? 1 : 0)
    if (left > 0) left -= 1
  }
  return out
}

export function initialDraft(memberIds: readonly string[]): SplitDraft {
  const participants = [...memberIds]
  return {
    mode: 'equal',
    participants,
    exact: {},
    percent: evenPercent(participants),
    shares: Object.fromEntries(participants.map((id) => [id, 1])),
    items: [newItem([...memberIds])],
    taxCents: null,
    tipCents: null,
    tipPercent: null,
  }
}

/** Rebuild a draft from a saved expense (for editing). Itemized opens as exact amounts. */
export function draftFromExpense(
  expense: Pick<ExpenseWithSplits, 'split_type' | 'expense_splits'>,
  memberIds: readonly string[],
): SplitDraft {
  const base = initialDraft(memberIds)
  const order = [...memberIds, ...expense.expense_splits.map((s) => s.user_id)]
  const inSplit = new Set(expense.expense_splits.map((s) => s.user_id))
  const participants = [...new Set(order)].filter((id) => inSplit.has(id))
  const byUser = new Map(expense.expense_splits.map((s) => [s.user_id, s]))

  const percent: Record<string, number> = {}
  if (expense.split_type === 'percent') {
    for (const id of participants) percent[id] = Math.round((byUser.get(id)?.weight ?? 0) * 100)
  }
  const percentOk =
    expense.split_type === 'percent' && Object.values(percent).reduce((a, b) => a + b, 0) === FULL

  return {
    ...base,
    mode: expense.split_type === 'itemized' ? 'exact' : expense.split_type,
    participants,
    exact: Object.fromEntries(participants.map((id) => [id, byUser.get(id)?.share_cents ?? 0])),
    percent: percentOk ? percent : evenPercent(participants),
    shares: Object.fromEntries(
      participants.map((id) => [
        id,
        expense.split_type === 'shares' ? (byUser.get(id)?.weight ?? 1) : 1,
      ]),
    ),
  }
}

/** People in the split who are no longer in the group (only an older expense can have them). */
export function formerParticipants(draft: SplitDraft, memberIds: readonly string[]): string[] {
  const members = new Set(memberIds)
  const people =
    draft.mode === 'itemized'
      ? [...new Set(billedItems(draft.items).flatMap((i) => i.userIds))]
      : draft.participants
  return people.filter((id) => !members.has(id))
}

/**
 * Whether two drafts split the same way: same mode, same people, same values. Saving an
 * unchanged split can leave the stored shares alone, which is the only way to keep someone who
 * has left the group in it (the server rejects them in a rewritten split).
 */
export function sameSplit(a: SplitDraft, b: SplitDraft): boolean {
  if (a.mode !== b.mode || a.mode === 'itemized') return false
  const people = new Set(b.participants)
  if (a.participants.length !== people.size || a.participants.some((id) => !people.has(id))) {
    return false
  }
  const values = a.mode === 'exact' ? 'exact' : a.mode === 'equal' ? null : a.mode
  if (!values) return true
  return a.participants.every((id) => (a[values][id] ?? 0) === (b[values][id] ?? 0))
}

/**
 * Toggle someone in or out of the split; percentages reset to even when the people change.
 * Someone coming back in gets at least one share, so they never rejoin owing nothing.
 */
export function toggleParticipant(
  draft: SplitDraft,
  id: string,
  memberOrder: readonly string[],
): SplitDraft {
  const has = draft.participants.includes(id)
  const set = new Set(draft.participants)
  if (has) set.delete(id)
  else set.add(id)
  const participants = memberOrder.filter((m) => set.has(m))
  const shares = draft.shares[id] ?? 0
  return {
    ...draft,
    participants,
    percent: evenPercent(participants),
    shares: { ...draft.shares, [id]: has ? shares : Math.max(1, shares) },
  }
}

/** Largest remainder spread of `total` over `weights` (all integers, non-negative). */
function spread(total: number, ids: string[], weights: number[]): Record<string, number> {
  const sum = weights.reduce((a, b) => a + b, 0)
  const w = sum === 0 ? ids.map(() => 1) : weights
  const wSum = sum === 0 ? ids.length : sum
  const rows = ids.map((id, i) => {
    const exact = (total * w[i]!) / wSum
    return { id, value: Math.floor(exact), rem: exact - Math.floor(exact) }
  })
  let left = total - rows.reduce((a, r) => a + r.value, 0)
  for (const row of [...rows].sort((a, b) => b.rem - a.rem)) {
    if (left <= 0) break
    row.value += 1
    left -= 1
  }
  return Object.fromEntries(rows.map((r) => [r.id, r.value]))
}

/**
 * Set one person's percentage (in basis points) and rebalance everyone else in proportion to
 * what they had, so the total stays at exactly 100%.
 */
export function setPercent(
  percent: Record<string, number>,
  order: readonly string[],
  id: string,
  value: number,
): Record<string, number> {
  const ids = order.filter((x) => x in percent)
  if (ids.length <= 1) return { ...percent, [id]: FULL }
  const next = Math.max(0, Math.min(FULL, Math.round(value)))
  const others = ids.filter((x) => x !== id)
  const rest = spread(
    FULL - next,
    others,
    others.map((x) => percent[x] ?? 0),
  )
  return { ...rest, [id]: next }
}

/**
 * Drag the boundary between `order[index]` and `order[index + 1]` to `cumulative` basis
 * points from the start. Only those two people change; everyone else keeps their share.
 */
export function moveBoundary(
  percent: Record<string, number>,
  order: readonly string[],
  index: number,
  cumulative: number,
): Record<string, number> {
  const left = order[index]
  const right = order[index + 1]
  if (left === undefined || right === undefined) return percent
  const before = order.slice(0, index).reduce((a, id) => a + (percent[id] ?? 0), 0)
  const pair = (percent[left] ?? 0) + (percent[right] ?? 0)
  const leftValue = Math.max(0, Math.min(pair, Math.round(cumulative) - before))
  return { ...percent, [left]: leftValue, [right]: pair - leftValue }
}

/** Quick tip choices, as a percent of the item subtotal. */
export const TIP_PERCENTS = [15, 18, 20] as const

/** A tip of `percent` on `subtotalCents`, rounded to the nearest minor unit. */
export function tipFor(subtotalCents: number, percent: number): number {
  return Math.round((subtotalCents * percent) / 100)
}

export function itemsSubtotal(items: readonly ItemDraft[]): number {
  return items.reduce((a, item) => a + (item.amountCents ?? 0), 0)
}

/** Keeps a picked tip percent true to the current subtotal; a typed tip is left alone. */
export function withTip(draft: SplitDraft): SplitDraft {
  if (draft.tipPercent === null) return draft
  return { ...draft, tipCents: tipFor(itemsSubtotal(draft.items), draft.tipPercent) }
}

export function itemsTotal(draft: Pick<SplitDraft, 'items' | 'taxCents' | 'tipCents'>): number {
  return itemsSubtotal(draft.items) + (draft.taxCents ?? 0) + (draft.tipCents ?? 0)
}

/** Items that count toward the bill: anything with a price or a name. */
function billedItems(items: readonly ItemDraft[]): ItemDraft[] {
  return items.filter((i) => (i.amountCents ?? 0) > 0 || i.name.trim() !== '')
}

/** Everyone's share in minor units for the current draft, via the core split functions. */
export function previewSplit(draft: SplitDraft, amountCents: number): SplitResult {
  switch (draft.mode) {
    case 'equal':
      return splitEqual(amountCents, draft.participants)
    case 'exact':
      return splitExact(
        amountCents,
        Object.fromEntries(draft.participants.map((id) => [id, draft.exact[id] ?? 0])),
      )
    case 'percent':
      return splitPercent(
        amountCents,
        Object.fromEntries(draft.participants.map((id) => [id, (draft.percent[id] ?? 0) / 100])),
      )
    case 'shares':
      return splitShares(
        amountCents,
        Object.fromEntries(draft.participants.map((id) => [id, draft.shares[id] ?? 0])),
      )
    case 'itemized': {
      return splitItemized(
        billedItems(draft.items).map((i) => ({
          amountCents: i.amountCents ?? 0,
          userIds: i.userIds,
        })),
        { taxCents: draft.taxCents ?? 0, tipCents: draft.tipCents ?? 0 },
      )
    }
  }
}

/**
 * Who pays a cent more than their exact share so the split adds up, for the current draft and
 * its preview. Exact amounts are typed, so they never round.
 */
export function roundingExtras(draft: SplitDraft, result: SplitResult): string[] {
  if (!result.ok) return []
  const weightsOf = (from: Record<string, number>, scale = 1) =>
    Object.fromEntries(draft.participants.map((id) => [id, (from[id] ?? 0) / scale]))
  switch (draft.mode) {
    case 'exact':
      return []
    case 'equal':
      return roundedUp({ mode: 'equal', userIds: draft.participants }, result.shares)
    case 'percent':
      return roundedUp({ mode: 'percent', percents: weightsOf(draft.percent, 100) }, result.shares)
    case 'shares':
      return roundedUp({ mode: 'shares', shareCounts: weightsOf(draft.shares) }, result.shares)
    case 'itemized':
      return roundedUp(
        {
          mode: 'itemized',
          items: billedItems(draft.items).map((i) => ({
            amountCents: i.amountCents ?? 0,
            userIds: i.userIds,
          })),
        },
        result.shares,
      )
  }
}

/** The amount the expense is for: typed, or the items total when itemized. */
export function effectiveAmount(draft: SplitDraft, typedCents: number | null): number {
  return draft.mode === 'itemized' ? itemsTotal(draft) : (typedCents ?? 0)
}

/**
 * `splits` for `create_expense` / `update_expense`. Equal, percent and shares send people and
 * weights (the server derives the cents); exact and itemized send cents. People with nothing
 * are left out.
 */
export function splitsPayload(draft: SplitDraft, amountCents: number): ExpenseSplitInput[] {
  switch (draft.mode) {
    case 'equal':
      return draft.participants.map((user_id) => ({ user_id }))
    case 'percent':
      return draft.participants
        .filter((id) => (draft.percent[id] ?? 0) > 0)
        .map((user_id) => ({ user_id, weight: (draft.percent[user_id] ?? 0) / 100 }))
    case 'shares':
      return draft.participants
        .filter((id) => (draft.shares[id] ?? 0) > 0)
        .map((user_id) => ({ user_id, weight: draft.shares[user_id] ?? 0 }))
    case 'exact':
    case 'itemized': {
      const result = previewSplit(draft, amountCents)
      if (!result.ok) return []
      return Object.entries(result.shares)
        .filter(([, cents]) => cents > 0)
        .map(([user_id, share_cents]) => ({ user_id, share_cents }))
    }
  }
}
