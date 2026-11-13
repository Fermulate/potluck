import { allocate, compareIds, type Shares } from './allocate'

export type SplitResult = { ok: true; shares: Shares } | { ok: false; error: SplitError }

export type SplitError =
  | { code: 'invalid_total' }
  | { code: 'no_users' }
  | { code: 'duplicate_user'; userId: string }
  | { code: 'invalid_amount'; userId: string }
  /** `difference` is what is still unassigned: positive means too little, negative too much. */
  | { code: 'sum_mismatch'; expected: number; actual: number; difference: number }
  | { code: 'invalid_weight'; userId: string }
  | { code: 'percent_sum'; actual: number }
  | { code: 'zero_shares' }
  | { code: 'no_items' }
  | { code: 'item_no_users'; index: number }
  | { code: 'invalid_item_amount'; index: number }
  | { code: 'invalid_extra' }
  /** Adjustments add up to more than the total, by `difference`. */
  | { code: 'adjustments_exceed_total'; difference: number }
  /** A minus adjustment takes this person below zero. */
  | { code: 'negative_share'; userId: string }

const fail = (error: SplitError): SplitResult => ({ ok: false, error })

/** Percents and share counts are fixed-point with this many decimals before allocation. */
const WEIGHT_SCALE = 1_000_000

/** Convert decimal weights (percents, share counts) to scaled integers, in sorted id order. */
function scaleWeights(
  weights: Readonly<Record<string, number>>,
): { ok: true; weights: Map<string, bigint> } | { ok: false; error: SplitError } {
  const ids = Object.keys(weights).sort(compareIds)
  if (ids.length === 0) return { ok: false, error: { code: 'no_users' } }
  const scaled = new Map<string, bigint>()
  for (const id of ids) {
    const value = weights[id]!
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, error: { code: 'invalid_weight', userId: id } }
    }
    scaled.set(id, BigInt(Math.round(value * WEIGHT_SCALE)))
  }
  return { ok: true, weights: scaled }
}

function sumOf(weights: ReadonlyMap<string, bigint>): bigint {
  let sum = 0n
  for (const w of weights.values()) sum += w
  return sum
}

function isCents(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function findDuplicate(ids: readonly string[]): string | undefined {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) return id
    seen.add(id)
  }
  return undefined
}

/** Split `totalCents` evenly. Leftover cents go to users in ascending id order. */
export function splitEqual(totalCents: number, userIds: readonly string[]): SplitResult {
  if (!isCents(totalCents)) return fail({ code: 'invalid_total' })
  if (userIds.length === 0) return fail({ code: 'no_users' })
  const duplicate = findDuplicate(userIds)
  if (duplicate !== undefined) return fail({ code: 'duplicate_user', userId: duplicate })

  const weights = new Map(userIds.map((id) => [id, 1n]))
  return { ok: true, shares: allocate(totalCents, weights) }
}

/** Accept explicit per-user amounts, as long as they add up to `totalCents`. */
export function splitExact(totalCents: number, amounts: Readonly<Shares>): SplitResult {
  if (!isCents(totalCents)) return fail({ code: 'invalid_total' })
  const ids = Object.keys(amounts).sort(compareIds)
  if (ids.length === 0) return fail({ code: 'no_users' })

  let actual = 0
  for (const id of ids) {
    if (!isCents(amounts[id]!)) return fail({ code: 'invalid_amount', userId: id })
    actual += amounts[id]!
  }
  if (actual !== totalCents) {
    return fail({
      code: 'sum_mismatch',
      expected: totalCents,
      actual,
      difference: totalCents - actual,
    })
  }
  return { ok: true, shares: Object.fromEntries(ids.map((id) => [id, amounts[id]!])) }
}

/**
 * Split by percentage. Percents may have up to 6 decimals and must add up to exactly 100.
 * Leftover cents go to the largest fractional remainder, ties by user id.
 */
export function splitPercent(
  totalCents: number,
  percents: Readonly<Record<string, number>>,
): SplitResult {
  if (!isCents(totalCents)) return fail({ code: 'invalid_total' })
  const scaled = scaleWeights(percents)
  if (!scaled.ok) return scaled
  const sum = sumOf(scaled.weights)
  if (sum !== BigInt(100 * WEIGHT_SCALE)) {
    return fail({ code: 'percent_sum', actual: Number(sum) / WEIGHT_SCALE })
  }
  return { ok: true, shares: allocate(totalCents, scaled.weights) }
}

/** Split proportionally to share counts (e.g. 2 shares for a couple). Fractional shares are fine. */
export function splitShares(
  totalCents: number,
  shareCounts: Readonly<Record<string, number>>,
): SplitResult {
  if (!isCents(totalCents)) return fail({ code: 'invalid_total' })
  const scaled = scaleWeights(shareCounts)
  if (!scaled.ok) return scaled
  if (sumOf(scaled.weights) === 0n) return fail({ code: 'zero_shares' })
  return { ok: true, shares: allocate(totalCents, scaled.weights) }
}

/**
 * Split by adjustment: each person's +/- amount comes off the top, and what is left is split
 * equally between everyone (largest remainder, ties by user id). Matches the `adjustment`
 * branch of `private.compute_split_rows`.
 */
export function splitAdjustment(
  totalCents: number,
  adjustments: Readonly<Record<string, number>>,
): SplitResult {
  if (!isCents(totalCents)) return fail({ code: 'invalid_total' })
  const ids = Object.keys(adjustments).sort(compareIds)
  if (ids.length === 0) return fail({ code: 'no_users' })
  let adjusted = 0
  for (const id of ids) {
    const value = adjustments[id]!
    if (!Number.isSafeInteger(value)) return fail({ code: 'invalid_amount', userId: id })
    adjusted += value
  }
  const rest = totalCents - adjusted
  if (rest < 0) return fail({ code: 'adjustments_exceed_total', difference: -rest })
  const equal = allocate(rest, new Map(ids.map((id) => [id, 1n])))
  const shares: Shares = {}
  for (const id of ids) {
    const share = equal[id]! + adjustments[id]!
    if (share < 0) return fail({ code: 'negative_share', userId: id })
    shares[id] = share
  }
  return { ok: true, shares }
}

export interface SplitItem {
  amountCents: number
  /** People sharing this item equally. */
  userIds: readonly string[]
}

export interface SplitExtras {
  taxCents?: number
  tipCents?: number
  /** Comes off the bill and is shared out like tax and tip. */
  discountCents?: number
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b))

/** Each person's exact item subtotal, scaled by the item head counts' lcm so it stays whole. */
function itemizedWeights(items: readonly SplitItem[]): Map<string, bigint> {
  let lcm = 1n
  for (const item of items) {
    const n = BigInt(item.userIds.length)
    if (n > 0n) lcm = (lcm * n) / gcd(lcm, n)
  }
  const weights = new Map<string, bigint>()
  for (const item of items) {
    if (item.userIds.length === 0) continue
    const perPerson = (BigInt(item.amountCents) * lcm) / BigInt(item.userIds.length)
    for (const id of item.userIds) weights.set(id, (weights.get(id) ?? 0n) + perPerson)
  }
  return weights
}

/**
 * Itemized bill: each item is shared equally by its people, then tax and tip (added) and any
 * discount (taken off) are spread in proportion to each person's subtotal. Rounding happens once
 * over the whole bill (largest remainder, ties by user id), so the result sums exactly to
 * items + tax + tip - discount. Matches `private.itemized_splits`.
 */
export function splitItemized(items: readonly SplitItem[], extras: SplitExtras = {}): SplitResult {
  if (items.length === 0) return fail({ code: 'no_items' })
  const taxCents = extras.taxCents ?? 0
  const tipCents = extras.tipCents ?? 0
  const discountCents = extras.discountCents ?? 0
  if (!isCents(taxCents) || !isCents(tipCents) || !isCents(discountCents)) {
    return fail({ code: 'invalid_extra' })
  }

  let itemsTotal = 0
  for (const [index, item] of items.entries()) {
    if (!isCents(item.amountCents)) return fail({ code: 'invalid_item_amount', index })
    if (item.userIds.length === 0) return fail({ code: 'item_no_users', index })
    const duplicate = findDuplicate(item.userIds)
    if (duplicate !== undefined) return fail({ code: 'duplicate_user', userId: duplicate })
    itemsTotal += item.amountCents
  }
  const weights = itemizedWeights(items)

  const total = itemsTotal + taxCents + tipCents - discountCents
  if (total < 0) return fail({ code: 'invalid_extra' })
  if (!isCents(total)) return fail({ code: 'invalid_total' })
  if (itemsTotal === 0) {
    if (total > 0) return fail({ code: 'zero_shares' })
    return { ok: true, shares: Object.fromEntries([...weights.keys()].map((id) => [id, 0])) }
  }
  return { ok: true, shares: allocate(total, weights) }
}

/** What an allocated split was worked out from, for `roundedUp`. Exact splits never round. */
export type SplitBasis =
  | { mode: 'equal'; userIds: readonly string[] }
  | { mode: 'percent'; percents: Readonly<Record<string, number>> }
  | { mode: 'shares'; shareCounts: Readonly<Record<string, number>> }
  | { mode: 'itemized'; items: readonly SplitItem[] }
  | { mode: 'adjustment'; adjustments: Readonly<Record<string, number>> }

/**
 * Who got one of the leftover cents: the people whose share in `shares` is above their exact,
 * fractional share. Shares only come out uneven like this to make them add up to the total, so
 * the list is empty whenever the total divided evenly. Sorted by user id.
 */
export function roundedUp(basis: SplitBasis, shares: Readonly<Shares>): string[] {
  if (basis.mode === 'adjustment') {
    // Only the equal part rounds; take the adjustments back off and look at that.
    const ids = Object.keys(basis.adjustments)
    const equalPart = Object.fromEntries(
      ids.map((id) => [id, (shares[id] ?? 0) - basis.adjustments[id]!]),
    )
    return roundedUp({ mode: 'equal', userIds: ids }, equalPart)
  }
  let weights: Map<string, bigint>
  switch (basis.mode) {
    case 'equal':
      weights = new Map(basis.userIds.map((id) => [id, 1n]))
      break
    case 'percent':
    case 'shares': {
      const scaled = scaleWeights(basis.mode === 'percent' ? basis.percents : basis.shareCounts)
      if (!scaled.ok) return []
      weights = scaled.weights
      break
    }
    case 'itemized':
      weights = itemizedWeights(basis.items)
      break
  }
  const sum = sumOf(weights)
  if (sum === 0n) return []
  let total = 0n
  for (const id of weights.keys()) total += BigInt(shares[id] ?? 0)
  return [...weights.keys()]
    .filter((id) => BigInt(shares[id] ?? 0) * sum > total * weights.get(id)!)
    .sort(compareIds)
}
