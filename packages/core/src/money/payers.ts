import { compareIds, type Shares } from './allocate'

/** One person's part of what was paid (or, for a refund, received), in minor units. */
export interface Payer {
  userId: string
  paidCents: number
}

export type PayersError =
  | { code: 'no_payers' }
  | { code: 'duplicate_payer'; userId: string }
  | { code: 'invalid_paid_amount'; userId: string }
  /** `difference` is what is still unpaid: positive means too little, negative too much. */
  | { code: 'payers_sum_mismatch'; expected: number; actual: number; difference: number }

export type PayersResult = { ok: true; payers: Shares } | { ok: false; error: PayersError }

/**
 * Check who paid an expense against its total, the same rule as `private.save_expense`:
 * amounts are whole minor units, zero means "did not pay" and is dropped, at least one person
 * paid, and the amounts add up to exactly `totalCents`. The result is keyed by user id in id
 * order.
 */
export function checkPayers(totalCents: number, payers: readonly Payer[]): PayersResult {
  const seen = new Set<string>()
  const out: Shares = {}
  let actual = 0
  for (const payer of [...payers].sort((a, b) => compareIds(a.userId, b.userId))) {
    if (seen.has(payer.userId)) {
      return { ok: false, error: { code: 'duplicate_payer', userId: payer.userId } }
    }
    seen.add(payer.userId)
    if (!Number.isSafeInteger(payer.paidCents) || payer.paidCents < 0) {
      return { ok: false, error: { code: 'invalid_paid_amount', userId: payer.userId } }
    }
    if (payer.paidCents === 0) continue
    out[payer.userId] = payer.paidCents
    actual += payer.paidCents
  }
  if (Object.keys(out).length === 0) return { ok: false, error: { code: 'no_payers' } }
  if (actual !== totalCents) {
    return {
      ok: false,
      error: {
        code: 'payers_sum_mismatch',
        expected: totalCents,
        actual,
        difference: totalCents - actual,
      },
    }
  }
  return { ok: true, payers: out }
}

/**
 * The payer older clients see in `expenses.paid_by`: whoever paid the most, ties to the smaller
 * user id. Matches `private.save_expense`.
 */
export function primaryPayer(payers: Readonly<Shares>): string | undefined {
  let best: string | undefined
  for (const id of Object.keys(payers).sort(compareIds)) {
    if (best === undefined || payers[id]! > payers[best]!) best = id
  }
  return best
}
