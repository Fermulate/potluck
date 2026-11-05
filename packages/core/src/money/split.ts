import { allocate, type Shares } from './allocate'

export type SplitResult = { ok: true; shares: Shares } | { ok: false; error: SplitError }

export type SplitError = { code: 'no_users' }

/** Split `totalCents` evenly. Leftover cents go to users in ascending id order. */
export function splitEqual(totalCents: number, userIds: readonly string[]): SplitResult {
  if (userIds.length === 0) return { ok: false, error: { code: 'no_users' } }
  const weights = new Map(userIds.map((id) => [id, 1n]))
  return { ok: true, shares: allocate(totalCents, weights) }
}
