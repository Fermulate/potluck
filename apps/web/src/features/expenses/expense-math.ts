import type { ExpenseWithSplits, MoneyMember } from '@potluck/api'
import { convert, minorUnits } from '@potluck/core'
import { t } from '@potluck/i18n'
import { categoryLabel } from './format'

export type ViewerLine =
  { kind: 'lent'; cents: number } | { kind: 'borrowed'; cents: number } | { kind: 'none' }

/** What an expense means for the viewer, in the expense currency. */
export function viewerLine(expense: ExpenseWithSplits, viewerId: string): ViewerLine {
  const mine = expense.expense_splits.find((s) => s.user_id === viewerId)?.share_cents ?? 0
  if (expense.paid_by === viewerId) {
    const lent = expense.amount_cents - mine
    return lent > 0 ? { kind: 'lent', cents: lent } : { kind: 'none' }
  }
  return mine > 0 ? { kind: 'borrowed', cents: mine } : { kind: 'none' }
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

function cell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value)
  // Quote anything with separators, quotes or newlines; neutralize spreadsheet formulas.
  const safe = /^[=+\-@]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/** A spreadsheet-friendly export: one row per expense, one share column per member. */
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
      const converted = convert(e.amount_cents, e.fx_rate, { from: e.currency, to: groupCurrency })
      return [
        e.spent_at,
        e.description,
        categoryLabel(e.category),
        nameOf(e.paid_by),
        decimal(e.amount_cents, e.currency),
        e.currency,
        String(Number(e.fx_rate)),
        decimal(converted, groupCurrency),
        ...ids.map((id) => {
          const share = e.expense_splits.find((s) => s.user_id === id)
          return share ? decimal(share.share_cents, e.currency) : ''
        }),
        e.notes ?? '',
      ]
    })

  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
