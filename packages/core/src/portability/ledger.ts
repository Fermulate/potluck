import { expenseEffect, pairEffect } from '../balances'
import { convert } from '../currency'
import { compareIds } from '../money/allocate'
import { isBlankRow, toCsv, unguardCell, type CsvValue } from './csv'
import { formatMinor, parseMinor, trimRate } from './decimal'
import {
  CURRENCY_CODE,
  isoDay,
  type EntryKind,
  type SourceEntry,
  type SourceFile,
  type SourceIssue,
  type SourceTotal,
} from './source'

/**
 * Potluck's spreadsheet export, and reading it back.
 *
 * One row per expense, refund or payment, then a Balance row per group. Fixed columns first,
 * then three per person (what they paid, their share, and what the row did to their balance in
 * the group currency), then notes and items. Refunds are negative in the amount, paid and share
 * columns, so summing a column gives what was really spent; a payment is "paid" by whoever paid
 * and is the "share" of whoever got it. The balance columns use the same conversion and rounding
 * as the balances screen (`expenseEffect`), so each one adds up to that person's balance to the
 * cent. A friend export keeps only the two people and adds what each row does between them.
 *
 * Column names come from `LedgerLabels` (the app's language), so the reader is given the label
 * sets to recognise.
 */

export interface LedgerLabels {
  date: string
  group: string
  type: string
  description: string
  category: string
  amount: string
  currency: string
  rate: string
  groupCurrency: string
  groupAmount: string
  paidBy: string
  notes: string
  items: string
  /** Per person columns; each contains `{name}`. */
  paid: string
  share: string
  balance: string
  /** Friend export: what the row does between the two of you; contains `{name}`. */
  between: string
  kinds: Record<EntryKind | 'balance', string>
  /** Item list extras. */
  tax: string
  tip: string
  discount: string
  /** Category id to label, for writing; and label back to id when reading. */
  categories: Readonly<Record<string, string>>
}

export interface LedgerExpense {
  description: string
  category: string | null
  notes: string | null
  /** YYYY-MM-DD. */
  spentAt: string
  createdAt: string
  amountCents: number
  currency: string
  fxRate: string | number
  isRefund: boolean
  payers: readonly { userId: string; paidCents: number }[]
  splits: readonly { userId: string; shareCents: number }[]
  items?: readonly { description: string; amountCents: number; userIds: readonly string[] }[]
  taxCents?: number | null
  tipCents?: number | null
  discountCents?: number | null
}

export interface LedgerPayment {
  fromUser: string
  toUser: string
  amountCents: number
  currency: string
  fxRate: string | number
  note: string | null
  /** YYYY-MM-DD, the UTC day it was recorded (the day its rate is from). */
  day: string
  settledAt: string
}

export interface LedgerGroup {
  name: string
  currency: string
  expenses: readonly LedgerExpense[]
  payments: readonly LedgerPayment[]
}

export interface LedgerOptions {
  labels: LedgerLabels
  /** Everyone to give columns to, in column order. */
  people: readonly { id: string; name: string }[]
  /** "Ava paid Ben": the description of a payment. */
  paymentText: (fromUser: string, toUser: string) => string
  /** Only what is shared between `me` and `friend`, with a between-you column. */
  friend?: { me: string; friend: string }
}

const fill = (template: string, name: string) => template.replaceAll('{name}', name)

/** Unique column names: a second "Alex" becomes "Alex (2)". */
function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((name) => {
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    return n === 1 ? name : `${name} (${n})`
  })
}

function itemsText(expense: LedgerExpense, labels: LedgerLabels, nameOf: (id: string) => string) {
  const money = (cents: number) => formatMinor(cents, expense.currency)
  const parts = (expense.items ?? []).map(
    (item) =>
      `${item.description || '?'} ${money(item.amountCents)} (${item.userIds.map(nameOf).join(', ')})`,
  )
  if (expense.taxCents) parts.push(`${labels.tax} ${money(expense.taxCents)}`)
  if (expense.tipCents) parts.push(`${labels.tip} ${money(expense.tipCents)}`)
  if (expense.discountCents) parts.push(`${labels.discount} ${money(-expense.discountCents)}`)
  return parts.join('; ')
}

/** The effect of one expense on everyone, in the group currency (positive = is owed). */
function effectOf(expense: LedgerExpense, groupCurrency: string): Record<string, number> {
  return (
    expenseEffect(
      {
        paidBy: expense.payers[0]?.userId ?? '',
        payers: expense.payers,
        isRefund: expense.isRefund,
        amountCents: expense.amountCents,
        currency: expense.currency,
        fxRate: expense.fxRate,
        splits: expense.splits,
      },
      { groupCurrency },
    ) ?? {}
  )
}

/** The export as CSV text. */
export function ledgerCsv(groups: readonly LedgerGroup[], options: LedgerOptions): string {
  const { labels, friend, paymentText } = options
  const people = friend
    ? options.people.filter((p) => p.id === friend.me || p.id === friend.friend)
    : options.people
  const names = uniqueNames(people.map((p) => p.name))
  const nameOf = (id: string) => names[people.findIndex((p) => p.id === id)] ?? id
  const friendName = friend ? nameOf(friend.friend) : ''

  const header: string[] = [
    labels.date,
    labels.group,
    labels.type,
    labels.description,
    labels.category,
    labels.amount,
    labels.currency,
    labels.rate,
    labels.groupCurrency,
    labels.groupAmount,
    labels.paidBy,
    ...names.flatMap((name) =>
      friend
        ? [fill(labels.paid, name), fill(labels.share, name)]
        : [fill(labels.paid, name), fill(labels.share, name), fill(labels.balance, name)],
    ),
    ...(friend ? [fill(labels.between, friendName)] : []),
    labels.notes,
    labels.items,
  ]
  const rows: CsvValue[][] = [header]

  for (const group of groups) {
    const gc = group.currency
    const totals = new Map<string, number>()
    let between = 0
    const add = (id: string, cents: number) => totals.set(id, (totals.get(id) ?? 0) + cents)

    type Line = { day: string; at: string; cells: CsvValue[] }
    const lines: Line[] = []

    for (const e of group.expenses) {
      const effect = effectOf(e, gc)
      for (const [id, cents] of Object.entries(effect)) add(id, cents)
      const pair = friend ? pairEffect(effect, friend.me, friend.friend) : 0
      if (friend) {
        const involved = (id: string) =>
          e.payers.some((p) => p.userId === id) || e.splits.some((s) => s.userId === id)
        if (pair === 0 && !(involved(friend.me) && involved(friend.friend))) continue
        between += pair
      }
      const sign = e.isRefund ? -1 : 1
      const payers = [...e.payers].sort((a, b) => b.paidCents - a.paidCents)
      const perPerson = people.flatMap((p) => {
        const paid = e.payers.find((x) => x.userId === p.id)?.paidCents
        const share = e.splits.find((x) => x.userId === p.id)?.shareCents
        const cells: CsvValue[] = [
          paid ? formatMinor(sign * paid, e.currency) : '',
          share ? formatMinor(sign * share, e.currency) : '',
        ]
        if (!friend) cells.push(p.id in effect ? formatMinor(effect[p.id]!, gc) : '')
        return cells
      })
      lines.push({
        day: e.spentAt,
        at: e.createdAt,
        cells: [
          e.spentAt,
          group.name,
          labels.kinds[e.isRefund ? 'refund' : 'expense'],
          e.description,
          e.category ? (labels.categories[e.category] ?? e.category) : '',
          formatMinor(sign * e.amountCents, e.currency),
          e.currency,
          trimRate(e.fxRate),
          gc,
          formatMinor(sign * convert(e.amountCents, e.fxRate, { from: e.currency, to: gc }), gc),
          payers.length > 1
            ? payers
                .map((p) => `${nameOf(p.userId)} ${formatMinor(sign * p.paidCents, e.currency)}`)
                .join('; ')
            : nameOf(payers[0]?.userId ?? ''),
          ...perPerson,
          ...(friend ? [formatMinor(pair, gc)] : []),
          e.notes ?? '',
          itemsText(e, labels, nameOf),
        ],
      })
    }

    for (const s of group.payments) {
      const converted = convert(s.amountCents, s.fxRate, { from: s.currency, to: gc })
      add(s.fromUser, converted)
      add(s.toUser, -converted)
      let pair = 0
      if (friend) {
        const ids = [s.fromUser, s.toUser]
        if (!ids.includes(friend.me) || !ids.includes(friend.friend)) continue
        pair = s.fromUser === friend.me ? converted : -converted
        between += pair
      }
      const amount = formatMinor(s.amountCents, s.currency)
      const perPerson = people.flatMap((p) => {
        const cells: CsvValue[] = [
          p.id === s.fromUser ? amount : '',
          p.id === s.toUser ? amount : '',
        ]
        if (!friend) {
          cells.push(
            p.id === s.fromUser
              ? formatMinor(converted, gc)
              : p.id === s.toUser
                ? formatMinor(-converted, gc)
                : '',
          )
        }
        return cells
      })
      lines.push({
        day: s.day,
        at: s.settledAt,
        cells: [
          s.day,
          group.name,
          labels.kinds.payment,
          paymentText(s.fromUser, s.toUser),
          '',
          amount,
          s.currency,
          trimRate(s.fxRate),
          gc,
          formatMinor(converted, gc),
          nameOf(s.fromUser),
          ...perPerson,
          ...(friend ? [formatMinor(pair, gc)] : []),
          s.note ?? '',
          '',
        ],
      })
    }

    if (lines.length === 0) continue
    lines.sort((a, b) => a.day.localeCompare(b.day) || a.at.localeCompare(b.at))
    for (const line of lines) rows.push(line.cells)
    rows.push([
      '',
      group.name,
      labels.kinds.balance,
      '',
      '',
      '',
      '',
      '',
      gc,
      '',
      '',
      ...people.flatMap((p) => {
        if (friend) return ['', '']
        const total = totals.get(p.id)
        return ['', '', total === undefined ? '' : formatMinor(total, gc)]
      }),
      ...(friend ? [formatMinor(between, gc)] : []),
      '',
      '',
    ])
  }

  return toCsv(rows)
}

// Reading it back ------------------------------------------------------------------------------

const FIXED = 11

function templateRegex(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{name\\}', '(.+)')
  return new RegExp(`^${escaped}$`)
}

interface Layout {
  labels: LedgerLabels
  people: string[]
  friend: boolean
}

function fixedHeader(labels: LedgerLabels): string[] {
  return [
    labels.date,
    labels.group,
    labels.type,
    labels.description,
    labels.category,
    labels.amount,
    labels.currency,
    labels.rate,
    labels.groupCurrency,
    labels.groupAmount,
    labels.paidBy,
  ]
}

function layoutOf(header: readonly string[], labelSets: readonly LedgerLabels[]): Layout | null {
  const cells = header.map((h) => h.trim())
  for (const labels of labelSets) {
    if (fixedHeader(labels).some((name, i) => cells[i] !== name)) continue
    if (cells.at(-2) !== labels.notes || cells.at(-1) !== labels.items) continue
    const middle = cells.slice(FIXED, -2)
    const paid = templateRegex(labels.paid)
    const between = templateRegex(labels.between)
    const friend = middle.length > 0 && between.test(middle.at(-1)!)
    const width = friend ? 2 : 3
    const personCols = friend ? middle.slice(0, -1) : middle
    if (personCols.length % width !== 0) continue
    const people: string[] = []
    let ok = true
    for (let i = 0; i < personCols.length; i += width) {
      const name = paid.exec(personCols[i]!)?.[1]
      if (name === undefined) ok = false
      else people.push(name)
    }
    if (ok) return { labels, people, friend }
  }
  return null
}

/** Whether the header is Potluck's export in one of `labelSets`. */
export function looksLikeLedger(
  rows: readonly string[][],
  labelSets: readonly LedgerLabels[],
): boolean {
  return rows.length > 0 && layoutOf(rows[0]!, labelSets) !== null
}

/** Read Potluck's export (call `looksLikeLedger` first). */
export function parseLedger(
  rows: readonly string[][],
  labelSets: readonly LedgerLabels[],
): SourceFile {
  const layout = layoutOf(rows[0] ?? [], labelSets)
  const issues: SourceIssue[] = []
  const entries: SourceEntry[] = []
  const totals: SourceTotal[] = []
  const checks: SourceFile['checks'] = []
  const groups: string[] = []
  if (!layout) {
    return {
      format: 'potluck',
      people: [],
      entries,
      totals,
      checks,
      groups,
      issues: [{ line: 0, code: 'unknown_format' }],
    }
  }
  const { labels, people, friend } = layout
  if (friend) {
    return {
      format: 'potluck',
      people,
      entries,
      totals,
      checks,
      groups,
      issues: [{ line: 0, code: 'friend_export' }],
    }
  }
  const kinds = new Map<string, EntryKind | 'balance'>(
    Object.entries(labels.kinds).map(([kind, label]) => [label, kind as EntryKind | 'balance']),
  )
  const categoryIds = new Map(Object.entries(labels.categories).map(([id, label]) => [label, id]))

  rows.slice(1).forEach((row, index) => {
    const line = index + 2
    if (isBlankRow(row)) return
    const cell = (i: number) => unguardCell((row[i] ?? '').trim())
    const kind = kinds.get(cell(2))
    const group = cell(1)
    if (!groups.includes(group)) groups.push(group)
    const groupCurrency = cell(8).toUpperCase()
    const currency = kind === 'balance' ? groupCurrency : cell(6).toUpperCase()
    if (!kind) {
      issues.push({ line, code: 'unknown_format', detail: cell(2) })
      return
    }
    if (!CURRENCY_CODE.test(currency) || !CURRENCY_CODE.test(groupCurrency)) {
      issues.push({ line, code: 'bad_currency', detail: kind === 'balance' ? cell(8) : cell(6) })
      return
    }

    const read = (col: number, cur: string): number | null => {
      const text = cell(col)
      return text === '' ? 0 : parseMinor(text, cur)
    }
    const paid: number[] = []
    const shares: number[] = []
    const nets: number[] = []
    for (let p = 0; p < people.length; p++) {
      const base = FIXED + p * 3
      const values = [read(base, currency), read(base + 1, currency), read(base + 2, groupCurrency)]
      const bad = values.findIndex((v) => v === null)
      if (bad !== -1) {
        issues.push({ line, code: 'bad_amount', detail: cell(base + bad) })
        return
      }
      paid.push(values[0]!)
      shares.push(values[1]!)
      nets.push(values[2]!)
    }

    if (kind === 'balance') {
      totals.push({ line, key: group, nets })
      return
    }

    const date = isoDay(cell(0))
    if (!date) {
      issues.push({ line, code: 'bad_date', detail: cell(0) })
      return
    }
    const amount = parseMinor(cell(5), currency)
    if (amount === null || amount === 0) {
      issues.push({ line, code: 'bad_amount', detail: cell(5) })
      return
    }
    const sign = kind === 'refund' ? -1 : 1
    const paidOut = paid.map((c) => sign * c || 0)
    const shareOut = shares.map((c) => sign * c || 0)
    const total = Math.abs(amount)
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
    const balanced =
      paidOut.every((c) => c >= 0) &&
      shareOut.every((c) => c >= 0) &&
      sum(paidOut) === total &&
      sum(shareOut) === total &&
      (kind !== 'payment' ||
        (paidOut.filter((c) => c > 0).length === 1 &&
          shareOut.filter((c) => c > 0).length === 1 &&
          paidOut.findIndex((c) => c > 0) !== shareOut.findIndex((c) => c > 0)))
    if (!balanced) {
      issues.push({ line, code: 'unbalanced' })
      return
    }
    entries.push({
      line,
      kind,
      date,
      description: cell(3),
      category: kind === 'payment' ? null : (categoryIds.get(cell(4)) ?? null),
      notes: cell(FIXED + people.length * 3) || null,
      amountCents: total,
      currency,
      group,
      paid: paidOut,
      shares: shareOut,
    })
    checks.push({ key: group, nets })
  })

  if (entries.length === 0 && issues.length === 0) issues.push({ line: 0, code: 'no_rows' })
  return { format: 'potluck', people, entries, totals, checks, groups, issues }
}

/** People ordered for columns: as given, then anyone else in `ids` (sorted, so files are stable). */
export function ledgerPeople(
  first: readonly { id: string; name: string }[],
  ids: Iterable<string>,
  nameOf: (id: string) => string,
): { id: string; name: string }[] {
  const out = [...first]
  const seen = new Set(out.map((p) => p.id))
  const extra = [...new Set(ids)].filter((id) => !seen.has(id)).sort(compareIds)
  for (const id of extra) out.push({ id, name: nameOf(id) })
  return out
}
