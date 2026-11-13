import { allocate, compareIds, type Shares } from '../money/allocate'
import { MAX_IMPORT_ROWS, type SourceEntry, type SourceFile, type SourceIssue } from './source'

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
}

export type ImportRow = ImportExpenseRow | ImportPaymentRow

export interface ImportOptions {
  /** Member id for each person in `SourceFile.people` (same order); null when not picked. */
  mapping: readonly (string | null)[]
  /** A several-group Potluck file: only this group's rows. */
  group?: string | null
  /** Description for a row that has none. */
  untitled: string
}

export interface ImportPlan {
  rows: ImportRow[]
  /** The file row each of `rows` came from (for errors the server names by row). */
  lines: number[]
  /** Rows that move no money once people are matched (everyone square, or paying themselves). */
  skipped: number[]
  /** Problems that stop the import: the file's own, and people left unmatched. */
  issues: SourceIssue[]
  /** What the import does to each member's balance, per currency, before any conversion. */
  effects: Record<string, Shares>
  /** Whether the rows add up to the totals the file carries ('none' if it has none). */
  totals: 'match' | 'mismatch' | 'none'
  counts: { expenses: number; refunds: number; payments: number }
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
    if (!id || cents === 0) return
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
    const shape = fromNets(entry.amountCents, nets)
    if (!shape) return null
    return {
      kind: 'expense',
      description,
      currency: entry.currency,
      spent_at: entry.date,
      category: entry.category,
      notes: entry.notes,
      is_refund: false,
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
 * Everything the import will write, worked out from the file and who each person is: the rows
 * for `import_expenses`, what they do to each balance (for the preview), and whatever stops the
 * import. Nothing here talks to the server.
 */
export function planImport(file: SourceFile, options: ImportOptions): ImportPlan {
  const issues: SourceIssue[] = [...file.issues]
  const inScope = (e: { group: string | null }) =>
    !options.group || file.format !== 'potluck' || e.group === options.group
  const entries = file.entries.filter(inScope)

  // Everyone with money in the rows being imported has to be someone in the group.
  const used = new Set<number>()
  for (const e of entries) {
    for (const values of [e.nets, e.paid, e.shares]) {
      values?.forEach((cents, i) => {
        if (cents !== 0) used.add(i)
      })
    }
  }
  for (const i of [...used].sort((a, b) => a - b)) {
    if (!options.mapping[i]) issues.push({ line: 0, code: 'unmapped', detail: file.people[i] })
  }

  const rows: ImportRow[] = []
  const lines: number[] = []
  const skipped: number[] = []
  const effects: Record<string, Shares> = {}
  const counts = { expenses: 0, refunds: 0, payments: 0 }
  if (!issues.some((i) => i.code === 'unmapped')) {
    for (const entry of entries) {
      const row = entryRow(entry, options)
      if (!row) {
        skipped.push(entry.line)
        continue
      }
      rows.push(row)
      lines.push(entry.line)
      if (row.kind === 'payment') counts.payments++
      else if (row.is_refund) counts.refunds++
      else counts.expenses++
      const bucket = (effects[row.currency] ??= {})
      for (const [id, cents] of Object.entries(rowEffect(row))) {
        bucket[id] = (bucket[id] ?? 0) + cents
      }
    }
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    issues.push({ line: 0, code: 'too_many_rows', detail: String(MAX_IMPORT_ROWS) })
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

  return { rows, lines, skipped, issues, effects, totals, counts }
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
      .replace(/[̀-ͯ]/g, '')
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
