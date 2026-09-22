import { allocate, type Shares } from './allocate'

export type SplitResult = { ok: true; shares: Shares } | { ok: false; error: SplitError }

export type SplitError =
  | { code: 'invalid_total' }
  | { code: 'no_users' }
  | { code: 'duplicate_user'; userId: string }

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
