import type { ExpenseWithSplits, MoneyGroup, MoneyPerson, Settlement } from '@potluck/api'
import {
  expenseEffect,
  ledgerCsv,
  ledgerPeople,
  utcDay,
  type BalanceExpense,
  type LedgerExpense,
  type LedgerPayment,
} from '@potluck/core'
import { formatMoney, t } from '@potluck/i18n'
import { ledgerLabels } from '@/features/export-import/labels'
import { joinNames } from '@/features/plans/format'
import { categoryLabel } from './format'

/** What an expense does to the viewer's balance, in the group currency. */
export type ViewerLine =
  { kind: 'lent'; cents: number } | { kind: 'borrowed'; cents: number } | { kind: 'none' }

/** First name for a user id, "You" for the viewer, or "you" with `lower` (mid-sentence). */
export type NameOf = (id: string, options?: { lower?: boolean }) => string

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
 * "You and Cleo", "Ben, you and Cleo": the viewer first, then the others in the order given.
 * Mid-sentence (`start: false`) the viewer reads "you".
 */
export function namesOf(
  ids: readonly string[],
  viewerId: string,
  nameOf: NameOf,
  { start = true, max = 2 }: { start?: boolean; max?: number } = {},
): string {
  const ordered = [...ids.filter((id) => id === viewerId), ...ids.filter((id) => id !== viewerId)]
  return joinNames(
    ordered.map((id, i) => nameOf(id, { lower: !start || i > 0 })),
    max,
  )
}

/**
 * What an expense means for the viewer: their change in the group balance, in the group
 * currency, from core `expenseEffect` (the same numbers as the `group_balances` view). Converting
 * first and spreading after is what the server does, so a row can never say "you borrowed $0.01"
 * while the balance is all square. "lent" means the group owes them; a refund is already flipped.
 */
export function viewerLine(
  expense: ExpenseWithSplits,
  viewerId: string,
  groupCurrency: string,
): ViewerLine {
  const effect = expenseEffect({ ...toBalanceExpense(expense), deletedAt: null }, { groupCurrency })
  const net = effect?.[viewerId] ?? 0
  return net > 0
    ? { kind: 'lent', cents: net }
    : net < 0
      ? { kind: 'borrowed', cents: -net }
      : { kind: 'none' }
}

/**
 * "Ava paid $90.00", "You and Ben paid $90.00", or for a refund "Ava got back $40.00".
 * The viewer comes first.
 */
export function paidSummary(
  expense: ExpenseWithSplits,
  viewerId: string,
  nameOf: NameOf,
  locale?: string,
): string {
  const amount = formatMoney(expense.amount_cents, expense.currency, { locale })
  const ids = payersOf(expense).map((p) => p.user_id)
  if (ids.length > 1) {
    const names = namesOf(ids, viewerId, nameOf)
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

/** An expense as the spreadsheet export takes it. */
export function toLedgerExpense(e: ExpenseWithSplits): LedgerExpense {
  return {
    description: e.description,
    category: e.category,
    notes: e.notes,
    spentAt: e.spent_at,
    createdAt: e.created_at,
    amountCents: e.amount_cents,
    currency: e.currency,
    fxRate: e.fx_rate,
    isRefund: e.is_refund,
    payers: payersOf(e).map((p) => ({ userId: p.user_id, paidCents: p.paid_cents })),
    splits: e.expense_splits.map((s) => ({ userId: s.user_id, shareCents: s.share_cents })),
    items: [...(e.expense_items ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        description: i.description,
        amountCents: i.amount_cents,
        userIds: i.user_ids,
      })),
    taxCents: e.tax_cents,
    tipCents: e.tip_cents,
    discountCents: e.discount_cents,
  }
}

/** A payment as the spreadsheet export takes it, dated the UTC day its rate is from. */
export function toLedgerPayment(s: Settlement): LedgerPayment {
  return {
    fromUser: s.from_user,
    toUser: s.to_user,
    amountCents: s.amount_cents,
    currency: s.currency,
    fxRate: s.fx_rate,
    note: s.note,
    day: utcDay(s.settled_at),
    settledAt: s.settled_at,
  }
}

/**
 * A group as a spreadsheet (core `ledgerCsv`): every expense and payment, a paid, share and
 * balance column per person (members first, then anyone who has left), and a balance row that
 * matches the balances screen to the cent. Column names follow the app's language.
 */
export function groupCsv(
  group: Pick<MoneyGroup, 'name' | 'currency' | 'members'>,
  expenses: readonly ExpenseWithSplits[],
  settlements: readonly Settlement[],
  people: ReadonlyMap<string, Pick<MoneyPerson, 'display_name'>>,
): string {
  const fullName = (id: string) => people.get(id)?.display_name ?? t('transfer.csv.someoneWhoLeft')
  const involved = [
    ...expenses.flatMap((e) => [
      ...payersOf(e).map((p) => p.user_id),
      ...e.expense_splits.map((s) => s.user_id),
    ]),
    ...settlements.flatMap((s) => [s.from_user, s.to_user]),
  ]
  return ledgerCsv(
    [
      {
        name: group.name,
        currency: group.currency,
        expenses: expenses.map(toLedgerExpense),
        payments: settlements.map(toLedgerPayment),
      },
    ],
    {
      labels: ledgerLabels(),
      people: ledgerPeople(
        group.members.map((m) => ({ id: m.id, name: m.display_name })),
        involved,
        fullName,
      ),
      paymentText: (from, to) =>
        t('transfer.import.rowPayment', { from: fullName(from), to: fullName(to) }),
      nameOf: fullName,
      categoryLabel,
    },
  )
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
