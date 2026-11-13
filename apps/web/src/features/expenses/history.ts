import { formatDate, formatMoney, hasMessage, t } from '@potluck/i18n'
import { namesOf, type NameOf } from './expense-math'
import { categoryLabel } from './format'

interface Change {
  from: unknown
  to: unknown
}

const isChange = (v: unknown): v is Change =>
  typeof v === 'object' && v !== null && 'from' in v && 'to' in v
const str = (v: unknown) => (typeof v === 'string' ? v : null)
const num = (v: unknown) => (typeof v === 'number' ? v : null)
const cents = (v: unknown): Record<string, number> =>
  typeof v === 'object' && v !== null
    ? Object.fromEntries(
        Object.entries(v).filter((e): e is [string, number] => typeof e[1] === 'number'),
      )
    : {}

/** Order the fields read in, the way Splitwise lists them. */
const ORDER = [
  'description',
  'amount_cents',
  'currency',
  'payers',
  'paid_by',
  'split',
  'split_type',
  'spent_at',
  'category',
  'notes',
  'is_refund',
  'receipt',
  'event_id',
] as const

const clip = (text: string) => (text.length > 60 ? `${text.slice(0, 57)}...` : text)

/**
 * The lines under one `expense.updated` history entry: every field the edit changed, with its old
 * and new value ("Amount: $90.00 to $96.00", "Paid by: you to you $60.00 and Ben $36.00").
 * `data` is the activity row's payload; entries from before `changes` existed give no lines.
 */
export function describeChanges(
  data: Record<string, unknown>,
  { viewerId, nameOf }: { viewerId: string; nameOf: NameOf },
): string[] {
  const changes = data.changes
  if (typeof changes !== 'object' || changes === null) return []
  const all = changes as Record<string, unknown>
  const currencyChange = isChange(all.currency) ? all.currency : null
  const newCurrency = str(data.currency) ?? 'USD'
  const oldCurrency = str(currencyChange?.from) ?? newCurrency
  const none = t('expenses.history.none')

  const money = (value: unknown, currency: string) => {
    const n = num(value)
    return n === null ? none : formatMoney(n, currency)
  }
  // "you $60.00 and Ben $36.00": each person with their amount, the viewer first.
  const withAmounts = (map: Record<string, number>, ids: string[], currency: string) =>
    namesOf(ids, viewerId, (id, o) => `${nameOf(id, o)} ${formatMoney(map[id]!, currency)}`, {
      start: false,
      max: 6,
    })
  // Each payer with what they paid, or just the name for one person.
  const people = (value: unknown, currency: string) => {
    const map = cents(value)
    const ids = Object.keys(map).sort()
    if (ids.length === 0) return none
    if (ids.length === 1) return namesOf(ids, viewerId, nameOf, { start: false })
    return withAmounts(map, ids, currency)
  }
  const split = (value: unknown, currency: string) => {
    if (typeof value !== 'object' || value === null) return none
    const { type, shares } = value as { type?: unknown; shares?: unknown }
    const key = `splitTypes.${str(type) ?? ''}.label`
    const label = hasMessage(key) ? t(key as 'splitTypes.equal.label') : none
    const map = cents(shares)
    return t('expenses.history.splitSide', {
      type: label.toLocaleLowerCase(),
      shares: withAmounts(map, Object.keys(map).sort(), currency),
    })
  }

  const lines: string[] = []
  for (const field of ORDER) {
    const change = all[field]
    if (!isChange(change)) continue
    switch (field) {
      case 'description':
        lines.push(
          t('expenses.history.change.description', {
            from: clip(str(change.from) ?? none),
            to: clip(str(change.to) ?? none),
          }),
        )
        break
      case 'amount_cents':
        lines.push(
          t('expenses.history.change.amount', {
            from: money(change.from, oldCurrency),
            to: money(change.to, newCurrency),
          }),
        )
        break
      case 'currency':
        lines.push(
          t('expenses.history.change.currency', {
            from: str(change.from) ?? none,
            to: str(change.to) ?? none,
          }),
        )
        break
      case 'payers':
        lines.push(
          t(
            data.is_refund ? 'expenses.history.change.received' : 'expenses.history.change.payers',
            {
              from: people(change.from, oldCurrency),
              to: people(change.to, newCurrency),
            },
          ),
        )
        break
      case 'paid_by': {
        const from = str(change.from)
        const to = str(change.to)
        lines.push(
          t(
            data.is_refund ? 'expenses.history.change.received' : 'expenses.history.change.payers',
            {
              from: from ? nameOf(from, { lower: true }) : none,
              to: to ? nameOf(to, { lower: true }) : none,
            },
          ),
        )
        break
      }
      case 'split':
        lines.push(
          t('expenses.history.change.split', {
            from: split(change.from, oldCurrency),
            to: split(change.to, newCurrency),
          }),
        )
        break
      case 'split_type': {
        const label = (v: unknown) => {
          const key = `splitTypes.${str(v) ?? ''}.label`
          return hasMessage(key) ? t(key as 'splitTypes.equal.label').toLocaleLowerCase() : none
        }
        lines.push(
          t('expenses.history.change.split', { from: label(change.from), to: label(change.to) }),
        )
        break
      }
      case 'spent_at': {
        const day = (v: unknown) => {
          const s = str(v)
          return s ? formatDate(s, { timeZone: 'UTC' }) : none
        }
        lines.push(
          t('expenses.history.change.date', { from: day(change.from), to: day(change.to) }),
        )
        break
      }
      case 'category':
        lines.push(
          t('expenses.history.change.category', {
            from: categoryLabel(str(change.from)),
            to: categoryLabel(str(change.to)),
          }),
        )
        break
      case 'notes': {
        const from = str(change.from)
        const to = str(change.to)
        lines.push(
          !from
            ? t('expenses.history.change.notesAdded', { to: clip(to ?? '') })
            : !to
              ? t('expenses.history.change.notesRemoved')
              : t('expenses.history.change.notes', { from: clip(from), to: clip(to) }),
        )
        break
      }
      case 'is_refund':
        lines.push(
          change.to === true
            ? t('expenses.history.change.refundOn')
            : t('expenses.history.change.refundOff'),
        )
        break
      case 'receipt':
        lines.push(
          change.to === true
            ? t('expenses.history.change.receiptAdded')
            : t('expenses.history.change.receiptRemoved'),
        )
        break
      case 'event_id':
        lines.push(t('expenses.history.change.plan'))
        break
    }
  }
  return lines
}
