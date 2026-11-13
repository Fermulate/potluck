import type { CategoryId } from '../categories'
import { isBlankRow } from './csv'
import { parseMinor } from './decimal'
import {
  CURRENCY_CODE,
  detectDateFormat,
  isoDay,
  type ReadOptions,
  type SourceEntry,
  type SourceFile,
  type SourceIssue,
  type SourceTotal,
} from './source'

/**
 * Splitwise's "Export as spreadsheet" (a group, or a friend, on the web app):
 *
 *   Date,Description,Category,Cost,Currency,Ava Smith,Ben Jones
 *   2026-03-01,Dinner,Dining out,90.00,USD,60.00,-30.00
 *   2026-03-02,Ben J. paid Ava S.,Payment,30.00,USD,-30.00,30.00
 *
 *   2026-03-05,Total balance, , ,USD,30.00,-30.00
 *
 * The first five columns are fixed (their names follow the account's language), then one column
 * per person: what the row did to them, paid minus share, so a positive number means they are
 * owed. Payments have the category "Payment" (translated). After a blank line, one "Total
 * balance" line per currency, with no cost. Splitwise never converts between currencies.
 */

/** "Payment" in the languages Splitwise exports in. */
const PAYMENT_WORDS = new Set([
  'payment',
  'zahlung',
  'pago',
  'paiement',
  'pagamento',
  'betaling',
  'betalning',
  'płatność',
  'platba',
  'pagament',
  'maksu',
  'ödeme',
  'платеж',
  'платёж',
  'תשלום',
  '支付',
  '付款',
])

/** Splitwise's categories (and their parent groups) to Potluck's. Anything else is "other". */
const CATEGORY_MAP: Record<string, CategoryId> = {
  'dining out': 'food',
  'food and drink': 'food',
  groceries: 'groceries',
  liquor: 'drinks',
  rent: 'rent',
  mortgage: 'rent',
  home: 'rent',
  'household supplies': 'shopping',
  furniture: 'shopping',
  electronics: 'shopping',
  clothing: 'shopping',
  gifts: 'gifts',
  electricity: 'utilities',
  'heat/gas': 'utilities',
  water: 'utilities',
  'tv/phone/internet': 'utilities',
  trash: 'utilities',
  cleaning: 'utilities',
  utilities: 'utilities',
  'utilities - other': 'utilities',
  'gas/fuel': 'gas',
  car: 'transport',
  parking: 'transport',
  'bus/train': 'transport',
  plane: 'transport',
  taxi: 'transport',
  bicycle: 'transport',
  transportation: 'transport',
  hotel: 'lodging',
  games: 'tickets',
  movies: 'tickets',
  music: 'tickets',
  sports: 'tickets',
  entertainment: 'tickets',
  'entertainment - other': 'tickets',
}

/** The Potluck category for a Splitwise one ("Dining out" -> food). */
export function splitwiseCategory(name: string): CategoryId {
  return CATEGORY_MAP[name.trim().toLowerCase()] ?? 'other'
}

function isPaymentCategory(category: string): boolean {
  return PAYMENT_WORDS.has(category.trim().toLowerCase())
}

/**
 * Whether the rows look like a Splitwise export: at least one person column after the five
 * fixed ones, and a data row with a date first and a currency code fifth.
 */
export function looksLikeSplitwise(rows: readonly string[][]): boolean {
  const [header, ...data] = rows
  if (!header || header.length < 6) return false
  const first = data.find((row) => !isBlankRow(row))
  return (
    !!first &&
    (isoDay(first[0] ?? '', 'mdy') !== null || isoDay(first[0] ?? '', 'dmy') !== null) &&
    CURRENCY_CODE.test((first[4] ?? '').trim())
  )
}

/**
 * Read a Splitwise export. Rows that cannot be read are listed in `issues`, not dropped. Dates
 * saved by a spreadsheet (3/1/26) are read month first or day first, whichever fits every row.
 * A negative cost is money that came back: the row becomes a refund.
 */
export function parseSplitwise(rows: readonly string[][], options: ReadOptions = {}): SourceFile {
  const [header = [], ...data] = rows
  const detected = detectDateFormat(
    data
      .filter((row) => !isBlankRow(row) && (row[3] ?? '').trim() !== '')
      .map((row) => row[0] ?? ''),
  )
  const dateFormat = options.dateFormat ?? detected.format
  const people = header.slice(5).map((name) => name.trim())
  const entries: SourceEntry[] = []
  const totals: SourceTotal[] = []
  const checks: SourceFile['checks'] = []
  const issues: SourceIssue[] = []

  data.forEach((row, index) => {
    const line = index + 2
    if (isBlankRow(row)) return
    const cell = (i: number) => (row[i] ?? '').trim()
    const currency = cell(4).toUpperCase()
    if (!CURRENCY_CODE.test(currency)) {
      issues.push({ line, code: 'bad_currency', detail: cell(4) })
      return
    }
    const nets: number[] = []
    for (let p = 0; p < people.length; p++) {
      const text = cell(5 + p)
      const cents = text === '' ? 0 : parseMinor(text, currency)
      if (cents === null) {
        issues.push({ line, code: 'bad_amount', detail: text })
        return
      }
      nets.push(cents)
    }

    // "Total balance": no cost and no category.
    if (cell(3) === '' && cell(2) === '') {
      totals.push({ line, key: currency, nets })
      return
    }

    const date = isoDay(cell(0), dateFormat)
    if (!date) {
      issues.push({ line, code: 'bad_date', detail: cell(0) })
      return
    }
    const cost = parseMinor(cell(3), currency)
    if (cost === null) {
      issues.push({ line, code: 'bad_amount', detail: cell(3) })
      return
    }
    if (nets.reduce((a, b) => a + b, 0) !== 0) {
      issues.push({ line, code: 'unbalanced' })
      return
    }
    const payment = isPaymentCategory(cell(2))
    entries.push({
      line,
      kind: payment ? 'payment' : cost < 0 ? 'refund' : 'expense',
      date,
      description: cell(1),
      category: payment ? null : splitwiseCategory(cell(2)),
      notes: null,
      amountCents: Math.abs(cost),
      currency,
      group: null,
      nets,
    })
    checks.push({ key: currency, nets })
  })

  if (entries.length === 0 && issues.length === 0) issues.push({ line: 0, code: 'no_rows' })
  return {
    format: 'splitwise',
    people,
    entries,
    totals,
    checks,
    groups: [],
    issues,
    dateFormat,
    dateAmbiguous: !options.dateFormat && detected.ambiguous,
  }
}
