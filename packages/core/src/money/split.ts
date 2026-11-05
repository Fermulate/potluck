import { allocate, compareIds, type Shares } from './allocate'

export type SplitResult = { ok: true; shares: Shares } | { ok: false; error: SplitError }

export type SplitError =
  | { code: 'invalid_total' }
  | { code: 'no_users' }
  | { code: 'duplicate_user'; userId: string }
  | { code: 'invalid_amount'; userId: string }
  /** `difference` is what is still unassigned: positive means too little, negative too much. */
  | { code: 'sum_mismatch'; expected: number; actual: number; difference: number }

const fail = (error: SplitError): SplitResult => ({ ok: false, error })

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
