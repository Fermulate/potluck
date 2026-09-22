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
