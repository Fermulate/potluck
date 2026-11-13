import { isSubcategory, parentCategory } from '../categories'
import { convert, crossRate } from '../currency'
import { allocate } from '../money/allocate'

/**
 * Spending totals: what a group spent, what the viewer paid, their share, and the payments they
 * made and received, per month and category, in the group currency.
 *
 * SQL twin: `public.expense_ledger` and `public.spending_summary` (same rules, same test cases in
 * `supabase/tests/25_search_insights.test.sql`). Each expense is converted once into the group
 * currency; the converted total is spread over the payers by what each paid and over the split
 * by each share (largest remainder, ties to the smaller user id), and a refund flips both signs,
 * exactly as `expenseEffect` does, so paid minus share always adds up to the balance.
 */

export interface LedgerSplit {
  userId: string
  shareCents: number
}

export interface LedgerExpense {
  id: string
  groupId: string
  /** The one payer. Ignored when `payers` is given. */
  paidBy: string
  /** Everyone who paid and how much, in the expense currency (`expense_payers`). */
  payers?: readonly { userId: string; paidCents: number }[]
  /** Money that came back: totals, paid and shares all count negative. */
  isRefund?: boolean
  amountCents: number
  /** Expense currency; only needed when it differs from the group currency. */
  currency?: string
  /** Rate into the group currency (`expenses.fx_rate`, decimal text). Defaults to 1. */
  fxRate?: number | string
  /** Calendar date, `YYYY-MM-DD`. */
  spentAt: string
  category?: string | null
  splits: readonly LedgerSplit[]
  deletedAt?: string | null
}

export interface LedgerPayment {
  groupId: string
  fromUser: string
  toUser: string
  amountCents: number
  currency?: string
  fxRate?: number | string
  /** The payment's calendar day in the viewer's zone, `YYYY-MM-DD`. */
  day: string
  deletedAt?: string | null
}

/** One expense seen from one person, in group currency. */
export interface LedgerLine {
  expenseId: string
  userId: string
  totalCents: number
  paidCents: number
  shareCents: number
}

/**
 * Who paid what and who owes what for one expense, in group currency (`expense_ledger` rows).
 * Live expenses only: a deleted expense has no lines.
 */
export function ledgerLines(expense: LedgerExpense, groupCurrency?: string): LedgerLine[] {
  if (expense.deletedAt) return []
  const splitWeights = weightsOf(expense.splits.map((s) => [s.userId, s.shareCents]))
  const payerWeights = weightsOf(
    (expense.payers ?? [{ userId: expense.paidBy, paidCents: expense.amountCents }]).map((p) => [
      p.userId,
      p.paidCents,
    ]),
  )
  if (sumOf(splitWeights) === 0n || sumOf(payerWeights) === 0n) return []

  const converted = convert(expense.amountCents, expense.fxRate ?? 1, {
    from: expense.currency,
    to: groupCurrency,
  })
  const sign = expense.isRefund ? -1 : 1
  const lines = new Map<string, LedgerLine>()
  const line = (userId: string) => {
    let found = lines.get(userId)
    if (!found) {
      found = {
        expenseId: expense.id,
        userId,
        totalCents: sign * converted,
        paidCents: 0,
        shareCents: 0,
      }
      lines.set(userId, found)
    }
    return found
  }
  for (const [userId, share] of Object.entries(allocate(converted, splitWeights))) {
    line(userId).shareCents += sign * share
  }
  for (const [userId, paid] of Object.entries(allocate(converted, payerWeights))) {
    line(userId).paidCents += sign * paid
  }
  return [...lines.values()]
}

function weightsOf(rows: readonly (readonly [string, number])[]): Map<string, bigint> {
  const weights = new Map<string, bigint>()
  for (const [userId, cents] of rows) {
    weights.set(userId, (weights.get(userId) ?? 0n) + BigInt(cents))
  }
  return weights
}

function sumOf(weights: ReadonlyMap<string, bigint>): bigint {
  let sum = 0n
  for (const w of weights.values()) sum += w
  return sum
}

/** What the viewer paid and owes for one expense, in group currency (zeros when not in it). */
export function viewerShare(
  expense: LedgerExpense,
  viewerId: string,
  groupCurrency?: string,
): { totalCents: number; paidCents: number; shareCents: number } {
  const lines = ledgerLines(expense, groupCurrency)
  const mine = lines.find((l) => l.userId === viewerId)
  return {
    totalCents: lines[0]?.totalCents ?? 0,
    paidCents: mine?.paidCents ?? 0,
    shareCents: mine?.shareCents ?? 0,
  }
}

/** One `spending_summary` row. `category` is null on the row that holds the payments. */
export interface SpendingRow {
  groupId: string
  currency: string
  /** First day of the month, `YYYY-MM-01`. */
  month: string
  category: string | null
  expenseCount: number
  spendCents: number
  paidCents: number
  shareCents: number
  paymentsMadeCents: number
  paymentsReceivedCents: number
  /** With `inCurrency`: expenses and payments left out because no rate was known for their day. */
  unconvertedCount: number
}

/** Currencies a Spending conversion may go through when two currencies have no rate between them. */
export const COMMON_BASES = ['USD', 'EUR'] as const

/**
 * The rate the Spending view converts with, from `from` into `to`: the direct rate (or its
 * inverse, which `rateOf` already tries, like `private.fx_rate`), else the product of the rates
 * through USD, then EUR, rounded to 12 decimals. Same rule as `private.insights_fx_rate`. Only
 * for totals shown in another currency: saving an expense never triangulates.
 */
export function spendingRate(
  from: string,
  to: string,
  rateOf: (from: string, to: string) => string | number | null,
): string | number | null {
  if (from === to) return 1
  const direct = rateOf(from, to)
  if (direct !== null) return direct
  for (const base of COMMON_BASES) {
    if (base === from || base === to) continue
    const first = rateOf(from, base)
    const second = rateOf(base, to)
    if (first !== null && second !== null) return crossRate(first, second)
  }
  return null
}

export interface SpendingInput {
  viewerId: string
  groupId: string
  groupCurrency: string
  expenses: readonly LedgerExpense[]
  payments?: readonly LedgerPayment[]
  /** Inclusive calendar day bounds, `YYYY-MM-DD`. */
  from?: string | null
  to?: string | null
  /**
   * Show everything in this currency instead of the group's. Each amount, already in group
   * currency, is converted once more at `rateOn(day)`: the expense's date, or the payment's day.
   */
  inCurrency?: string | null
  /**
   * Units of `inCurrency` per unit of the group currency on or before `day` (the same lookup as
   * `private.fx_rate`), as decimal text; null when no rate is known.
   */
  rateOn?: (day: string) => string | number | null
}

const monthOf = (day: string) => `${day.slice(0, 7)}-01`
const inRange = (day: string, from?: string | null, to?: string | null) =>
  (!from || day >= from) && (!to || day <= to)

/**
 * The viewer's spending in one group, as `spending_summary(group_id, from, to, in_currency)` returns it:
 * one row per month and category, plus one row per month for payments. Sorted like the SQL
 * (month, then category with the payments row last).
 */
export function spendingSummary(input: SpendingInput): SpendingRow[] {
  const target = input.inCurrency?.toUpperCase() || input.groupCurrency
  const rateFor = (day: string): string | number | null =>
    target === input.groupCurrency ? 1 : (input.rateOn?.(day) ?? null)
  const toTarget = (cents: number, rate: string | number) =>
    convert(cents, rate, { from: input.groupCurrency, to: target })
  const rows = new Map<string, SpendingRow>()
  const row = (month: string, category: string | null) => {
    const key = `${month}|${category ?? ''}`
    let found = rows.get(key)
    if (!found) {
      found = {
        groupId: input.groupId,
        currency: target,
        month,
        category,
        expenseCount: 0,
        spendCents: 0,
        paidCents: 0,
        shareCents: 0,
        paymentsMadeCents: 0,
        paymentsReceivedCents: 0,
        unconvertedCount: 0,
      }
      rows.set(key, found)
    }
    return found
  }

  for (const expense of input.expenses) {
    if (!inRange(expense.spentAt, input.from, input.to)) continue
    const lines = ledgerLines(expense, input.groupCurrency)
    if (lines.length === 0) continue
    const into = row(monthOf(expense.spentAt), expense.category || 'other')
    const rate = rateFor(expense.spentAt)
    if (rate === null) {
      into.unconvertedCount += 1
      continue
    }
    into.expenseCount += 1
    into.spendCents += toTarget(lines[0]!.totalCents, rate)
    for (const line of lines) {
      if (line.userId !== input.viewerId) continue
      into.paidCents += toTarget(line.paidCents, rate)
      into.shareCents += toTarget(line.shareCents, rate)
    }
  }

  for (const payment of input.payments ?? []) {
    if (payment.deletedAt || !inRange(payment.day, input.from, input.to)) continue
    const made = payment.fromUser === input.viewerId
    const received = payment.toUser === input.viewerId
    if (!made && !received) continue
    const amount = convert(payment.amountCents, payment.fxRate ?? 1, {
      from: payment.currency,
      to: input.groupCurrency,
    })
    const into = row(monthOf(payment.day), null)
    const rate = rateFor(payment.day)
    if (rate === null) {
      into.unconvertedCount += 1
      continue
    }
    if (made) into.paymentsMadeCents += toTarget(amount, rate)
    if (received) into.paymentsReceivedCents += toTarget(amount, rate)
  }

  return [...rows.values()].sort(compareRows)
}

function compareRows(a: SpendingRow, b: SpendingRow): number {
  if (a.month !== b.month) return a.month < b.month ? -1 : 1
  if (a.groupId !== b.groupId) return a.groupId < b.groupId ? -1 : 1
  if (a.category === b.category) return 0
  if (a.category === null) return 1
  if (b.category === null) return -1
  return a.category < b.category ? -1 : 1
}

export interface SpendingTotals {
  expenseCount: number
  /** Everything the group(s) spent. */
  spendCents: number
  /** What the viewer paid for. */
  paidCents: number
  /** The viewer's share of what was spent. */
  shareCents: number
  paymentsMadeCents: number
  paymentsReceivedCents: number
  /** Expenses and payments left out of a converted view for want of a rate. */
  unconvertedCount: number
  /**
   * How the viewer's balance moved: paid minus share, plus payments made, minus payments
   * received. Over all time this is the balance.
   */
  netCents: number
}

const emptyTotals = (): SpendingTotals => ({
  expenseCount: 0,
  spendCents: 0,
  paidCents: 0,
  shareCents: 0,
  paymentsMadeCents: 0,
  paymentsReceivedCents: 0,
  unconvertedCount: 0,
  netCents: 0,
})

function addRow(totals: SpendingTotals, row: SpendingRow) {
  totals.expenseCount += row.expenseCount
  totals.spendCents += row.spendCents
  totals.paidCents += row.paidCents
  totals.shareCents += row.shareCents
  totals.paymentsMadeCents += row.paymentsMadeCents
  totals.paymentsReceivedCents += row.paymentsReceivedCents
  totals.unconvertedCount += row.unconvertedCount
  totals.netCents +=
    row.paidCents - row.shareCents + row.paymentsMadeCents - row.paymentsReceivedCents
}

/** Totals of the rows. Callers pass rows in one currency (see `spendingCurrencies`). */
export function spendingTotals(rows: readonly SpendingRow[]): SpendingTotals {
  const totals = emptyTotals()
  for (const row of rows) addRow(totals, row)
  return totals
}

/** The currencies the rows are in, most spent first (by row count when amounts tie). */
export function spendingCurrencies(rows: readonly SpendingRow[]): string[] {
  const weight = new Map<string, { spend: number; count: number }>()
  for (const row of rows) {
    const w = weight.get(row.currency) ?? { spend: 0, count: 0 }
    w.spend += row.spendCents
    w.count += 1
    weight.set(row.currency, w)
  }
  return [...weight.entries()]
    .sort(
      ([a, x], [b, y]) => y.spend - x.spend || y.count - x.count || (a < b ? -1 : a > b ? 1 : 0),
    )
    .map(([currency]) => currency)
}

export interface Bucket<K extends string> {
  key: K
  totals: SpendingTotals
}

/** Totals per month, oldest first, with empty months between the first and last filled in. */
export function spendingByMonth(rows: readonly SpendingRow[]): Bucket<string>[] {
  const months = new Map<string, SpendingTotals>()
  for (const row of rows) {
    let totals = months.get(row.month)
    if (!totals) months.set(row.month, (totals = emptyTotals()))
    addRow(totals, row)
  }
  const keys = [...months.keys()].sort()
  if (keys.length === 0) return []
  const out: Bucket<string>[] = []
  for (let month = keys[0]!; month <= keys[keys.length - 1]!; month = nextMonth(month)) {
    out.push({ key: month, totals: months.get(month) ?? emptyTotals() })
  }
  return out
}

/**
 * Totals per expense category, largest share first (payments are left out). Subcategories count
 * toward their parent (a taxi is Transport); other stored values keep their own bucket.
 */
export function spendingByCategory(
  rows: readonly SpendingRow[],
  measure: 'shareCents' | 'spendCents' = 'shareCents',
): Bucket<string>[] {
  const categories = new Map<string, SpendingTotals>()
  for (const row of rows) {
    if (row.category === null) continue
    const key = isSubcategory(row.category) ? parentCategory(row.category) : row.category
    let totals = categories.get(key)
    if (!totals) categories.set(key, (totals = emptyTotals()))
    addRow(totals, row)
  }
  return [...categories.entries()]
    .map(([key, totals]) => ({ key, totals }))
    .filter((b) => b.totals[measure] !== 0)
    .sort(
      (a, b) =>
        b.totals[measure] - a.totals[measure] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    )
}

/** Totals per group, largest spend first. */
export function spendingByGroup(rows: readonly SpendingRow[]): Bucket<string>[] {
  const groups = new Map<string, SpendingTotals>()
  for (const row of rows) {
    let totals = groups.get(row.groupId)
    if (!totals) groups.set(row.groupId, (totals = emptyTotals()))
    addRow(totals, row)
  }
  return [...groups.entries()]
    .map(([key, totals]) => ({ key, totals }))
    .sort(
      (a, b) =>
        b.totals.spendCents - a.totals.spendCents || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    )
}

/** `YYYY-MM-01` one month later. */
export function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`
}

/** `YYYY-MM-01` one month earlier. */
export function previousMonth(month: string): string {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return m === 1 ? `${year - 1}-12-01` : `${year}-${String(m - 1).padStart(2, '0')}-01`
}

/** Last calendar day of a month given as `YYYY-MM-..`. */
export function monthEnd(month: string): string {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return `${month.slice(0, 7)}-${String(days).padStart(2, '0')}`
}
