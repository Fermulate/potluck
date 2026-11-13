import { expenseEffect } from '../balances'
import { convert, invertRate } from '../currency'
import { allocate, compareIds, type Shares } from '../money/allocate'
import { trimRate } from './decimal'
import { MAX_FILE_ROWS, type SourceEntry, type SourceFile, type SourceIssue } from './source'

/** An expense as `import_expenses` takes it: an exact split with every payer. */
export interface ImportExpenseRow {
  kind: 'expense'
  description: string
  amount_cents: number
  currency: string
  spent_at: string
  category: string | null
  notes: string | null
  is_refund: boolean
  payers: { user_id: string; paid_cents: number }[]
  splits: { user_id: string; share_cents: number }[]
  /** Rate into the group currency (decimal text); only for rows in another currency. */
  fx_rate?: string
  /** The person confirmed a typed rate far from Potluck's own (the server refuses it otherwise). */
  fx_rate_confirmed?: boolean
}

/** A payment as `import_expenses` takes it. */
export interface ImportPaymentRow {
  kind: 'payment'
  from_user: string
  to_user: string
  amount_cents: number
  currency: string
  paid_on: string
  note: string | null
  fx_rate?: string
  fx_rate_confirmed?: boolean
}

export type ImportRow = ImportExpenseRow | ImportPaymentRow

/** A mapping value: leave out every row this person has money in. */
export const SKIP_PERSON = '__skip__'

/** Why a row of the file is left out. */
export type SkipReason = 'no_effect' | 'person' | 'rate' | 'duplicate'

/** The stored rate for a day: decimal text, null when Potluck has none, undefined while loading. */
export type RateLookup = (currency: string, day: string) => string | null | undefined

export interface ImportOptions {
  /** For each person in `SourceFile.people`: a member id, null (not picked yet) or `SKIP_PERSON`. */
  mapping: readonly (string | null)[]
  /** A several-group Potluck file: only this group's rows. */
  group?: string | null
  /** Description for a row that has none. */
  untitled: string
  /** The group the rows go into. */
  groupCurrency: string
  /** Rates Potluck has stored, the same lookup the server makes. */
  rateOn?: RateLookup
  /** Rates typed in for currencies Potluck has no rate for on some days. */
  typedRates?: Readonly<Record<string, string>>
  /** Currencies whose rows without any rate are left out. */
  skipCurrencies?: ReadonlySet<string>
  /** Currencies whose typed rate the person confirmed although it is far from the stored one. */
  confirmedRates?: ReadonlySet<string>
  /** File lines to leave out (rows already in the group). */
  skipLines?: ReadonlySet<number>
}

/** A currency with rows on days Potluck has no rate for. */
export interface MissingRate {
  currency: string
  /** First and last such day. */
  from: string
  to: string
  /** Every such day, in order: the server holds a typed rate against the stored one nearest each. */
  days: string[]
  rows: number
  /** The rate typed for them, once it is a valid one. */
  typed: string | null
  /** Left out instead. */
  skipped: boolean
}

export interface ImportPlan {
  rows: ImportRow[]
  /** The file row each of `rows` came from (for errors the server names by row). */
  lines: number[]
  /** Rows left out, and why. */
  skipped: { line: number; reason: SkipReason }[]
  /** Problems that stop the import: the file's own, and people left unmatched. */
  issues: SourceIssue[]
  /** What the import does to each member's balance in the group currency, converted exactly as
   * the server will (every row carries its rate). */
  balances: Shares
  /** Stored rates still loading: the balances are not final yet. */
  ratesPending: boolean
  /** Currencies with rows on days Potluck has no rate for, and what is done about them; the
   * import waits while any has neither a typed rate nor `skipped`. */
  missingRates: MissingRate[]
  /** Rows that keep the rate their Potluck file was written with, and how many of those differ
   * from the rate Potluck has stored for that day. */
  fileRates: { rows: number; differ: number }
  /** Whether the rows add up to the totals the file carries ('none' if it has none). */
  totals: 'match' | 'mismatch' | 'none'
  counts: { expenses: number; refunds: number; payments: number }
}

const RATE = /^\d{1,12}(\.\d{1,12})?$/

/** A typed rate counts as far off outside this band around Potluck's nearest one (as the server). */
export const RATE_BAND = { low: 0.2, high: 5 } as const

/**
 * Whether a typed rate is far from Potluck's own for the pair (or there is none to compare with):
 * the server then wants `fx_rate_confirmed`. Only a warning test, so plain numbers are fine.
 */
export function rateIsOutlier(rate: string, reference: string | null | undefined): boolean {
  if (!reference || !(Number(reference) > 0)) return true
  const ratio = Number(rate) / Number(reference)
  return ratio < RATE_BAND.low || ratio > RATE_BAND.high
}

/** A rate someone typed or a file carries: positive decimal text that fits numeric(24,12). */
export function isRate(text: string | null | undefined): text is string {
  return !!text && RATE.test(text.trim()) && Number(text) > 0
}

/**
 * Payers and split for a row Splitwise only describes by what it did to each person
 * (paid minus share). Everyone who came out ahead paid; everyone behind owed their part. Paid
 * minus owed only fixes the payers' share up to what the cost leaves over, so that remainder is
 * spread equally across the payers (largest remainder, ties by id): one payer simply paid the
 * cost and kept their share, and the usual "two paid, all split equally" comes back exactly.
 * Either way every person's balance moves by exactly their net. Null when nobody moves.
 */
export function fromNets(
  cost: number,
  nets: ReadonlyMap<string, number>,
): Pick<ImportExpenseRow, 'amount_cents' | 'payers' | 'splits'> | null {
  const ids = [...nets.keys()].sort(compareIds)
  const ahead = ids.filter((id) => nets.get(id)! > 0)
  const behind = ids.filter((id) => nets.get(id)! < 0)
  const moved = ahead.reduce((sum, id) => sum + nets.get(id)!, 0)
  if (moved === 0) return null
  const rest = Math.max(cost - moved, 0)
  const extra = allocate(rest, new Map(ahead.map((id) => [id, 1n])))
  return {
    amount_cents: moved + rest,
    payers: ahead.map((id) => ({ user_id: id, paid_cents: nets.get(id)! + extra[id]! })),
    splits: [
      ...behind.map((id) => ({ user_id: id, share_cents: -nets.get(id)! })),
      ...ahead
        .filter((id) => extra[id]! > 0)
        .map((id) => ({ user_id: id, share_cents: extra[id]! })),
    ].sort((a, b) => compareIds(a.user_id, b.user_id)),
  }
}

/** Per member totals of per person values, through the mapping. */
function merge(
  values: readonly number[],
  mapping: readonly (string | null)[],
): Map<string, number> {
  const out = new Map<string, number>()
  values.forEach((cents, i) => {
    const id = mapping[i]
    if (!id || id === SKIP_PERSON || cents === 0) return
    out.set(id, (out.get(id) ?? 0) + cents)
  })
  for (const [id, cents] of out) if (cents === 0) out.delete(id)
  return out
}

function entryRow(entry: SourceEntry, options: ImportOptions): ImportRow | null {
  const { mapping } = options
  const description = (entry.description.trim() || options.untitled).slice(0, 120)

  if (entry.nets) {
    const nets = merge(entry.nets, mapping)
    if (entry.kind === 'payment') {
      const from = [...nets].filter(([, c]) => c > 0)
      const to = [...nets].filter(([, c]) => c < 0)
      if (from.length === 1 && to.length === 1) {
        return {
          kind: 'payment',
          from_user: from[0]![0],
          to_user: to[0]![0],
          amount_cents: from[0]![1],
          currency: entry.currency,
          paid_on: entry.date,
          note: null,
        }
      }
    }
    // A refund flips both signs, so it is rebuilt from the flipped nets: whoever came out behind
    // got the money back.
    const refund = entry.kind === 'refund'
    const shape = fromNets(
      entry.amountCents,
      refund ? new Map([...nets].map(([id, c]) => [id, -c])) : nets,
    )
    if (!shape) return null
    return {
      kind: 'expense',
      description,
      currency: entry.currency,
      spent_at: entry.date,
      category: entry.category,
      notes: entry.notes,
      is_refund: refund,
      ...shape,
    }
  }

  const paid = merge(entry.paid ?? [], mapping)
  const shares = merge(entry.shares ?? [], mapping)
  if (entry.kind === 'payment') {
    const [from] = [...paid.keys()]
    const [to] = [...shares.keys()]
    if (!from || !to || from === to) return null
    return {
      kind: 'payment',
      from_user: from,
      to_user: to,
      amount_cents: entry.amountCents,
      currency: entry.currency,
      paid_on: entry.date,
      note: entry.notes,
    }
  }
  // Everyone paid exactly their own share: it moves nothing.
  if ([...paid].every(([id, cents]) => shares.get(id) === cents) && paid.size === shares.size) {
    return null
  }
  const sorted = (m: Map<string, number>) => [...m].sort(([a], [b]) => compareIds(a, b))
  return {
    kind: 'expense',
    description,
    amount_cents: entry.amountCents,
    currency: entry.currency,
    spent_at: entry.date,
    category: entry.category,
    notes: entry.notes,
    is_refund: entry.kind === 'refund',
    payers: sorted(paid).map(([user_id, paid_cents]) => ({ user_id, paid_cents })),
    splits: sorted(shares).map(([user_id, share_cents]) => ({ user_id, share_cents })),
  }
}

/** What an import row does to each member, in its own currency (positive = is owed). */
export function rowEffect(row: ImportRow): Shares {
  const effect: Shares = {}
  const add = (id: string, cents: number) => {
    effect[id] = (effect[id] ?? 0) + cents
  }
  if (row.kind === 'payment') {
    add(row.from_user, row.amount_cents)
    add(row.to_user, -row.amount_cents)
    return effect
  }
  const sign = row.is_refund ? -1 : 1
  for (const p of row.payers) add(p.user_id, sign * p.paid_cents)
  for (const s of row.splits) add(s.user_id, -sign * s.share_cents)
  return effect
}

/**
 * What a row does to each member in the group currency, converted at `rate` the way the server
 * does (core `expenseEffect` for expenses, `convert` for payments), so the preview and the
 * balances after the import agree to the cent.
 */
export function rowEffectIn(row: ImportRow, groupCurrency: string, rate: string): Shares {
  if (row.kind === 'payment') {
    const cents = convert(row.amount_cents, rate, { from: row.currency, to: groupCurrency })
    return { [row.from_user]: cents, [row.to_user]: -cents }
  }
  return (
    expenseEffect(
      {
        paidBy: row.payers[0]?.user_id ?? '',
        payers: row.payers.map((p) => ({ userId: p.user_id, paidCents: p.paid_cents })),
        isRefund: row.is_refund,
        amountCents: row.amount_cents,
        currency: row.currency,
        fxRate: rate,
        splits: row.splits.map((s) => ({ userId: s.user_id, shareCents: s.share_cents })),
      },
      { groupCurrency },
    ) ?? {}
  )
}

/** The values a person has in a row (any of nets, paid, shares). */
function touches(entry: SourceEntry, person: number): boolean {
  return [entry.nets, entry.paid, entry.shares].some((v) => (v?.[person] ?? 0) !== 0)
}

/** Everyone with money in the rows of the file being imported (by index into `people`). */
export function peopleInScope(file: SourceFile, group?: string | null): number[] {
  const entries = file.entries.filter(
    (e) => !group || file.format !== 'potluck' || e.group === group,
  )
  return file.people.map((_, i) => i).filter((i) => entries.some((e) => touches(e, i)))
}

/**
 * Everything the import will write, worked out from the file and who each person is: the rows
 * for `import_expenses` (each with the rate it is converted at), what they do to each balance in
 * the group currency (for the preview), and whatever stops the import. Nothing here talks to the
 * server.
 */
export function planImport(file: SourceFile, options: ImportOptions): ImportPlan {
  const issues: SourceIssue[] = [...file.issues]
  const gc = options.groupCurrency
  const inScope = (e: { group: string | null }) =>
    !options.group || file.format !== 'potluck' || e.group === options.group
  const entries = file.entries.filter(inScope)

  // Everyone with money in the rows being imported has to be someone in the group, or skipped.
  for (const i of peopleInScope(file, options.group)) {
    if (!options.mapping[i]) issues.push({ line: 0, code: 'unmapped', detail: file.people[i] })
  }

  const rows: ImportRow[] = []
  const lines: number[] = []
  const skipped: ImportPlan['skipped'] = []
  const balances: Shares = {}
  const missing = new Map<string, MissingRate>()
  const missingDays = new Map<string, Set<string>>()
  const fileRates = { rows: 0, differ: 0 }
  let ratesPending = false
  const counts = { expenses: 0, refunds: 0, payments: 0 }

  if (!issues.some((i) => i.code === 'unmapped')) {
    for (const entry of entries) {
      if (options.skipLines?.has(entry.line)) {
        skipped.push({ line: entry.line, reason: 'duplicate' })
        continue
      }
      if (options.mapping.some((id, i) => id === SKIP_PERSON && touches(entry, i))) {
        skipped.push({ line: entry.line, reason: 'person' })
        continue
      }
      const row = entryRow(entry, options)
      if (!row) {
        skipped.push({ line: entry.line, reason: 'no_effect' })
        continue
      }

      let rate: string | null | undefined = '1'
      if (row.currency !== gc) {
        const day = row.kind === 'payment' ? row.paid_on : row.spent_at
        const stored = options.rateOn?.(row.currency, day)
        const fromFile = entry.groupCurrency === gc && isRate(entry.rate) ? entry.rate : null
        const typed = options.typedRates?.[row.currency]
        if (fromFile) {
          rate = fromFile
          fileRates.rows++
          if (stored && trimRate(stored) !== trimRate(fromFile)) fileRates.differ++
        } else if (stored === undefined) {
          rate = undefined
          ratesPending = true
        } else if (stored !== null) {
          rate = stored
        } else {
          // No stored rate: the currency stays listed whether a rate is typed, it is left out, or
          // neither yet, so the screen keeps its place while someone types.
          const usable = isRate(typed) ? typed.trim() : null
          const leftOut = !usable && !!options.skipCurrencies?.has(row.currency)
          const seen = missing.get(row.currency)
          missingDays.set(row.currency, (missingDays.get(row.currency) ?? new Set()).add(day))
          missing.set(row.currency, {
            currency: row.currency,
            from: !seen || day < seen.from ? day : seen.from,
            to: !seen || day > seen.to ? day : seen.to,
            days: [],
            rows: (seen?.rows ?? 0) + 1,
            typed: usable,
            skipped: leftOut,
          })
          if (leftOut) {
            skipped.push({ line: entry.line, reason: 'rate' })
            continue
          }
          rate = usable
          if (usable && options.confirmedRates?.has(row.currency)) row.fx_rate_confirmed = true
        }
        if (rate) row.fx_rate = rate
      }

      rows.push(row)
      lines.push(entry.line)
      if (row.kind === 'payment') counts.payments++
      else if (row.is_refund) counts.refunds++
      else counts.expenses++
      if (rate) {
        for (const [id, cents] of Object.entries(rowEffectIn(row, gc, rate))) {
          balances[id] = (balances[id] ?? 0) + cents
        }
      }
    }
  }
  if (rows.length > MAX_FILE_ROWS) {
    issues.push({ line: 0, code: 'too_many_rows', detail: String(MAX_FILE_ROWS) })
  }

  // The file's own totals against its rows, person by person.
  const keys = new Set(file.totals.map((t) => t.key))
  let totals: ImportPlan['totals'] = keys.size === 0 ? 'none' : 'match'
  for (const key of keys) {
    if (file.format === 'potluck' && options.group && key !== options.group) continue
    const expected = file.totals.filter((t) => t.key === key).at(-1)!.nets
    const actual = file.people.map(() => 0)
    for (const check of file.checks) {
      if (check.key !== key) continue
      check.nets.forEach((cents, i) => (actual[i]! += cents))
    }
    if (expected.some((cents, i) => cents !== actual[i])) totals = 'mismatch'
  }

  return {
    rows,
    lines,
    skipped,
    issues,
    balances,
    ratesPending,
    missingRates: [...missing.values()]
      .map((m) => ({ ...m, days: [...missingDays.get(m.currency)!].sort() }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    fileRates,
    totals,
    counts,
  }
}

/** An expense or payment already in the group, to spot rows imported before. */
export interface ExistingRow {
  kind: 'expense' | 'payment'
  day: string
  amountCents: number
  currency: string
  description?: string
  fromUser?: string
  toUser?: string
}

/**
 * File lines whose row looks like one already in the group: same day, amount and currency, and
 * the same description (expenses) or the same two people (payments). Each existing row matches
 * one file row at most, so a file with the same coffee twice only flags it twice if the group
 * has it twice.
 */
export function alreadyThere(
  plan: Pick<ImportPlan, 'rows' | 'lines'>,
  existing: readonly ExistingRow[],
): number[] {
  const key = (r: ExistingRow) =>
    r.kind === 'expense'
      ? `e|${r.day}|${r.amountCents}|${r.currency}|${(r.description ?? '').trim().toLowerCase()}`
      : `p|${r.day}|${r.amountCents}|${r.currency}|${r.fromUser}|${r.toUser}`
  const left = new Map<string, number>()
  for (const r of existing) left.set(key(r), (left.get(key(r)) ?? 0) + 1)
  const out: number[] = []
  plan.rows.forEach((row, i) => {
    const k = key(
      row.kind === 'expense'
        ? {
            kind: 'expense',
            day: row.spent_at,
            amountCents: row.amount_cents,
            currency: row.currency,
            description: row.description,
          }
        : {
            kind: 'payment',
            day: row.paid_on,
            amountCents: row.amount_cents,
            currency: row.currency,
            fromUser: row.from_user,
            toUser: row.to_user,
          },
    )
    const n = left.get(k) ?? 0
    if (n > 0) {
      left.set(k, n - 1)
      out.push(plan.lines[i]!)
    }
  })
  return out
}

/** The file row a server error points at (`import_row:<n>` in its hint), if any. */
export function failedLine(plan: Pick<ImportPlan, 'lines'>, hint: unknown): number | null {
  if (typeof hint !== 'string') return null
  const match = /^import_row:(\d+)$/.exec(hint)
  if (!match) return null
  return plan.lines[Number(match[1]) - 1] ?? null
}

/**
 * Best guess at who each person in the file is: the member with the same name, else the one
 * whose first name (or full name) the file's name starts with, else nobody. Each member is
 * guessed at most once.
 */
export function guessMapping(
  people: readonly string[],
  members: readonly { id: string; name: string }[],
): (string | null)[] {
  const norm = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .trim()
  const taken = new Set<string>()
  const pick = (test: (member: string, person: string) => boolean, person: string) => {
    const hits = members.filter((m) => !taken.has(m.id) && test(norm(m.name), norm(person)))
    return hits.length === 1 ? hits[0]!.id : null
  }
  const result: (string | null)[] = people.map(() => null)
  const passes: ((member: string, person: string) => boolean)[] = [
    (m, p) => m === p,
    (m, p) => p.startsWith(`${m} `) || m.startsWith(`${p} `),
    (m, p) => m.split(' ')[0] === p.split(' ')[0],
  ]
  for (const test of passes) {
    people.forEach((person, i) => {
      if (result[i] || !norm(person)) return
      const id = pick(test, person)
      if (id) {
        result[i] = id
        taken.add(id)
      }
    })
  }
  return result
}

/**
 * The rate the server takes for a day (`private.fx_rate`): the latest `from` to `to` rate on or
 * before it, else the latest inverse rate turned round (`invertRate`). Null when there is none.
 */
export function rateOnDay(
  history: {
    direct: readonly { day: string; rate: string }[]
    inverse: readonly { day: string; rate: string }[]
  },
  day: string,
): string | null {
  const latest = (rows: readonly { day: string; rate: string }[]) => {
    let best: { day: string; rate: string } | null = null
    for (const r of rows) if (r.day <= day && (!best || r.day > best.day)) best = r
    return best
  }
  const direct = latest(history.direct)
  if (direct) return direct.rate
  const inverse = latest(history.inverse)
  return inverse ? invertRate(inverse.rate) : null
}

/**
 * The stored rate a typed one is held against, as `import_expenses` picks it: the `from` to `to`
 * rate (or the inverse one turned round) whose day is nearest `day` on either side, the later day
 * on a tie and the direct rate before the inverse one on the same day. Null when there is none.
 */
export function nearestRate(
  history: {
    direct: readonly { day: string; rate: string }[]
    inverse: readonly { day: string; rate: string }[]
  },
  day: string,
): string | null {
  const target = Date.parse(`${day}T00:00:00Z`)
  let best: { gap: number; day: string; inverse: number; rate: string } | null = null
  const consider = (rows: readonly { day: string; rate: string }[], inverse: number) => {
    for (const r of rows) {
      const gap = Math.abs(Date.parse(`${r.day}T00:00:00Z`) - target)
      const better =
        !best ||
        gap < best.gap ||
        (gap === best.gap && (r.day > best.day || (r.day === best.day && inverse < best.inverse)))
      if (better) best = { gap, day: r.day, inverse, rate: r.rate }
    }
  }
  consider(history.direct, 0)
  consider(history.inverse, 1)
  if (!best) return null
  const found: { inverse: number; rate: string } = best
  return found.inverse ? invertRate(found.rate) : found.rate
}
