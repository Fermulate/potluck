import type { ExpenseWithSplits, MoneyMember, Settlement } from '@potluck/api'
import { convert, minorUnits, type BalanceExpense } from '@potluck/core'
import { formatMoney, t } from '@potluck/i18n'
import { joinNames } from '@/features/plans/format'
import { categoryLabel } from './format'

export type ViewerLine =
  { kind: 'lent'; cents: number } | { kind: 'borrowed'; cents: number } | { kind: 'none' }

/** Everyone who paid and how much; an expense read without payers had one, `paid_by`. */
export function payersOf(
  expense: Pick<ExpenseWithSplits, 'paid_by' | 'amount_cents'> &
    Partial<Pick<ExpenseWithSplits, 'expense_payers'>>,
): { user_id: string; paid_cents: number }[] {
  const payers = expense.expense_payers ?? []
  return payers.length > 0
    ? [...payers].sort((a, b) => b.paid_cents - a.paid_cents)
    : [{ user_id: expense.paid_by, paid_cents: expense.amount_cents }]
}

/**
 * What an expense means for the viewer, in the expense currency: what they paid minus their
 * share. A refund flips it (the payers received the money). "lent" means the group owes them.
 */
export function viewerLine(expense: ExpenseWithSplits, viewerId: string): ViewerLine {
  const mine = expense.expense_splits.find((s) => s.user_id === viewerId)?.share_cents ?? 0
  const paid = payersOf(expense).find((p) => p.user_id === viewerId)?.paid_cents ?? 0
  const net = (expense.is_refund ? -1 : 1) * (paid - mine)
  return net > 0
    ? { kind: 'lent', cents: net }
    : net < 0
      ? { kind: 'borrowed', cents: -net }
      : { kind: 'none' }
}

/**
 * "Ava paid $90.00", "You and Ben paid $90.00", or for a refund "Ava got back $40.00".
 * `nameOf` gives "You" for the viewer.
 */
export function paidSummary(
  expense: ExpenseWithSplits,
  viewerId: string,
  nameOf: (id: string) => string,
  locale?: string,
): string {
  const amount = formatMoney(expense.amount_cents, expense.currency, { locale })
  const ids = payersOf(expense).map((p) => p.user_id)
  if (ids.length > 1) {
    const names = joinNames(ids.map(nameOf), 2)
    return expense.is_refund
      ? t('expenses.refund.gotBackMany', { names, amount })
      : t('expenses.payers.paidMany', { names, amount })
  }
  const [only] = ids
  if (only === viewerId) {
    return expense.is_refund
      ? t('expenses.refund.youGotBack', { amount })
      : t('expenses.youPaid', { amount })
  }
  return expense.is_refund
    ? t('expenses.refund.gotBack', { name: nameOf(only!), amount })
    : t('expenses.paidSummary', { name: nameOf(only!), amount })
}

/** An expense as core's balance functions take it (every payer, refund sign). */
export function toBalanceExpense(expense: ExpenseWithSplits): BalanceExpense {
  return {
    paidBy: expense.paid_by,
    payers: payersOf(expense).map((p) => ({ userId: p.user_id, paidCents: p.paid_cents })),
    isRefund: expense.is_refund,
    amountCents: expense.amount_cents,
    currency: expense.currency,
    fxRate: expense.fx_rate,
    splits: expense.expense_splits.map((s) => ({ userId: s.user_id, shareCents: s.share_cents })),
    deletedAt: expense.deleted_at,
  }
}

/**
 * People who have left the group but still carry money in this expense: the payer, or anyone
 * with a share. The server keeps such an expense's amounts, payer and split as they are and
 * will not delete it, so screens lock those parts.
 */
export function departedMembers(
  expense: Pick<ExpenseWithSplits, 'paid_by' | 'expense_splits'> &
    Partial<Pick<ExpenseWithSplits, 'expense_payers'>>,
  memberIds: readonly string[],
): string[] {
  const members = new Set(memberIds)
  const involved = [
    expense.paid_by,
    ...(expense.expense_payers ?? []).map((p) => p.user_id),
    ...expense.expense_splits.filter((s) => s.share_cents > 0).map((s) => s.user_id),
  ]
  return [...new Set(involved)].filter((id) => !members.has(id))
}

/** Plain decimal for a CSV cell: 1234 USD cents -> "12.34", 1500 JPY -> "1500". */
export function decimal(cents: number, currency: string): string {
  const digits = minorUnits(currency)
  if (digits === 0) return String(cents)
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const scale = 10 ** digits
  return `${sign}${Math.floor(abs / scale)}.${String(abs % scale).padStart(digits, '0')}`
}

/** Leading characters that make Excel, Sheets or LibreOffice treat a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/

function cell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value)
  // Neutralize spreadsheet formulas (a plain negative number is fine); quote anything with
  // separators, quotes or newlines.
  const safe = FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/**
 * A spreadsheet-friendly export: one row per expense, one share column per member. With several
 * payers the payer cell lists each one and what they paid. Refunds are negative (amount, group
 * amount and shares), so summing a column gives what was really spent.
 */
export function expensesToCsv(
  expenses: readonly ExpenseWithSplits[],
  members: readonly MoneyMember[],
  groupCurrency: string,
): string {
  const nameOf = (id: string) => members.find((m) => m.id === id)?.display_name ?? id
  // Former members who still appear in splits get a column too.
  const ids = [...members.map((m) => m.id)]
  for (const e of expenses) {
    for (const s of e.expense_splits) if (!ids.includes(s.user_id)) ids.push(s.user_id)
  }

  const header = [
    t('expenses.csv.date'),
    t('expenses.csv.description'),
    t('expenses.csv.category'),
    t('expenses.csv.paidBy'),
    t('expenses.csv.amount'),
    t('expenses.csv.currency'),
    t('expenses.csv.rate'),
    t('expenses.csv.groupAmount', { currency: groupCurrency }),
    ...ids.map((id) => t('expenses.csv.shareOf', { name: nameOf(id) })),
    t('expenses.csv.notes'),
  ]

  const rows = [...expenses]
    .sort(
      (a, b) => a.spent_at.localeCompare(b.spent_at) || a.created_at.localeCompare(b.created_at),
    )
    .map((e) => {
      const sign = e.is_refund ? -1 : 1
      const converted = convert(e.amount_cents, e.fx_rate, { from: e.currency, to: groupCurrency })
      const payers = payersOf(e)
      return [
        e.spent_at,
        e.description,
        categoryLabel(e.category),
        payers.length > 1
          ? payers
              .map((p) => `${nameOf(p.user_id)} ${decimal(p.paid_cents, e.currency)}`)
              .join('; ')
          : nameOf(payers[0]!.user_id),
        decimal(sign * e.amount_cents, e.currency),
        e.currency,
        String(Number(e.fx_rate)),
        decimal(sign * converted, groupCurrency),
        ...ids.map((id) => {
          const share = e.expense_splits.find((s) => s.user_id === id)
          return share ? decimal(sign * share.share_cents, e.currency) : ''
        }),
        e.notes ?? '',
      ]
    })

  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}

/** "You paid Kai $20.00", "Kai paid you $20.00" or "Kai paid Lena $20.00". */
export function settlementText(
  settlement: Settlement,
  viewerId: string,
  nameOf: (id: string) => string,
  locale?: string,
): string {
  const amount = formatMoney(settlement.amount_cents, settlement.currency, { locale })
  return settlement.from_user === viewerId
    ? t('settle.youPaid', { name: nameOf(settlement.to_user), amount })
    : settlement.to_user === viewerId
      ? t('settle.paidYou', { name: nameOf(settlement.from_user), amount })
      : t('settle.paid', {
          from: nameOf(settlement.from_user),
          to: nameOf(settlement.to_user),
          amount,
        })
}
