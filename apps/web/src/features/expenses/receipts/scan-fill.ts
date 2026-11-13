import type { ReceiptScan } from '@potluck/core'
import { t } from '@potluck/i18n'
import { itemsTotal, newItem, type SplitDraft } from '../form/split-state'

/** Which parts of a scan the person kept (each is a checkbox in the review). */
export interface ScanChoice {
  name: boolean
  date: boolean
  total: boolean
  items: boolean
}

/** What a scan changes in the expense form. Missing keys leave that field alone. */
export interface ScanFill {
  description?: string
  spentAt?: string
  currency?: string
  amount?: number
  draft?: SplitDraft
}

/** What the review starts with ticked: everything it found, except a name over a typed one. */
export function defaultChoice(scan: ReceiptScan, description: string): ScanChoice {
  return {
    name: !!scan.merchant && description.trim() === '',
    date: !!scan.date,
    total: scan.totalCents !== null,
    items: scan.items.length > 0,
  }
}

/** Whether the scan found anything the form could use. */
export function scanFoundSomething(scan: ReceiptScan): boolean {
  return scan.totalCents !== null || scan.items.length > 0
}

/** The bill the items, tax, tip and discount make, in minor units. */
export function scanItemsTotal(scan: ReceiptScan): number {
  return (
    scan.items.reduce((a, i) => a + i.amountCents, 0) +
    (scan.taxCents ?? 0) +
    (scan.tipCents ?? 0) -
    (scan.discountCents ?? 0)
  )
}

/**
 * Turns the parts of a scan the person kept into form changes. Items go into the by-item editor
 * with everyone in the split on every line, ready to be untapped; tax, tip and discount come
 * along. When the receipt's total is more than its lines, the difference becomes one more line
 * so the expense matches the paper. A receipt in another currency switches the form to it, since
 * its amounts are in that currency's units.
 */
export function fillFromScan(
  scan: ReceiptScan,
  choice: ScanChoice,
  { draft, currency, memberIds }: { draft: SplitDraft; currency: string; memberIds: string[] },
): ScanFill {
  const fill: ScanFill = {}
  if (choice.name && scan.merchant) fill.description = scan.merchant.slice(0, 120)
  if (choice.date && scan.date) fill.spentAt = scan.date
  const usesAmounts =
    (choice.total && scan.totalCents !== null) || (choice.items && scan.items.length > 0)
  if (usesAmounts && scan.currency && scan.currency !== currency) fill.currency = scan.currency

  if (choice.items && scan.items.length > 0) {
    const people = draft.participants.length > 0 ? draft.participants : memberIds
    const items = scan.items.map((item) => ({
      ...newItem([...people]),
      name: (item.quantity > 1
        ? t('expenses.scan.quantity', { count: item.quantity, name: item.description })
        : item.description
      ).slice(0, 80),
      amountCents: item.amountCents,
    }))
    const next: SplitDraft = {
      ...draft,
      mode: 'itemized',
      items,
      taxCents: scan.taxCents,
      tipCents: scan.tipCents,
      discountCents: scan.discountCents,
      tipPercent: null,
    }
    const missing =
      choice.total && scan.totalCents !== null ? scan.totalCents - itemsTotal(next) : 0
    if (missing > 0) {
      next.items = [
        ...items,
        { ...newItem([...people]), name: t('expenses.scan.rest'), amountCents: missing },
      ]
    }
    fill.draft = next
    fill.amount = itemsTotal(next)
  } else if (choice.total && scan.totalCents !== null) {
    fill.amount = scan.totalCents
    if (draft.mode === 'itemized') fill.draft = { ...draft, mode: 'equal' }
  }
  return fill
}
