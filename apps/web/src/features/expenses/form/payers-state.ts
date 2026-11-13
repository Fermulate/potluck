import type { ExpensePayer, ExpenseWithSplits } from '@potluck/api'
import { checkPayers, primaryPayer, type PayersResult } from '@potluck/core'
import { t } from '@potluck/i18n'

/**
 * Who paid, as the form edits it: one person (the common case, and the only one older clients
 * know), or several people with what each paid.
 */
export type PayersDraft =
  { mode: 'single'; paidBy: string } | { mode: 'several'; amounts: Record<string, number | null> }

export function payersFromExpense(
  expense: Pick<ExpenseWithSplits, 'paid_by' | 'expense_payers'>,
): PayersDraft {
  const payers = expense.expense_payers ?? []
  if (payers.length <= 1) return { mode: 'single', paidBy: payers[0]?.user_id ?? expense.paid_by }
  return {
    mode: 'several',
    amounts: Object.fromEntries(payers.map((p) => [p.user_id, p.paid_cents])),
  }
}

/** Core's check of the draft against the total (one payer always pays it all). */
export function checkDraftPayers(draft: PayersDraft, totalCents: number): PayersResult {
  if (draft.mode === 'single') {
    return checkPayers(totalCents, [{ userId: draft.paidBy, paidCents: totalCents }])
  }
  return checkPayers(
    totalCents,
    Object.entries(draft.amounts).map(([userId, cents]) => ({ userId, paidCents: cents ?? 0 })),
  )
}

/** The reason the payers do not work, as a sentence, or null when they do. */
export function payersErrorText(result: PayersResult): string | null {
  return result.ok ? null : t(`errors.payers.${result.error.code}`)
}

/** People who paid something, in id order (all of them for one payer). */
export function payerIds(draft: PayersDraft): string[] {
  if (draft.mode === 'single') return [draft.paidBy]
  return Object.entries(draft.amounts)
    .filter(([, cents]) => (cents ?? 0) > 0)
    .map(([id]) => id)
}

/**
 * `paid_by` and `payers` for `create_expense_v2` / `update_expense_v2`. The list is always sent,
 * so going back from several payers to one replaces the stored payers. With several, `paid_by`
 * is whoever paid the most (the server works it out the same way).
 */
export function payersPayload(
  draft: PayersDraft,
  totalCents: number,
): { paid_by: string; payers: ExpensePayer[] } {
  const result = checkDraftPayers(draft, totalCents)
  if (draft.mode === 'single' || !result.ok) {
    const paidBy = draft.mode === 'single' ? draft.paidBy : (payerIds(draft)[0] ?? '')
    return { paid_by: paidBy, payers: [{ user_id: paidBy, paid_cents: totalCents }] }
  }
  return {
    paid_by: primaryPayer(result.payers)!,
    payers: Object.entries(result.payers).map(([user_id, paid_cents]) => ({ user_id, paid_cents })),
  }
}

/** Amount still to assign across several payers: positive is missing, negative too much. */
export function payersLeft(draft: PayersDraft, totalCents: number): number {
  if (draft.mode === 'single') return 0
  return totalCents - Object.values(draft.amounts).reduce<number>((a, c) => a + (c ?? 0), 0)
}

/** Switch to several payers, starting with whoever paid it all so far. */
export function toSeveral(draft: PayersDraft, totalCents: number): PayersDraft {
  if (draft.mode === 'several') return draft
  return { mode: 'several', amounts: { [draft.paidBy]: totalCents > 0 ? totalCents : null } }
}
