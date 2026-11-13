import { CATEGORY_IDS, type LedgerLabels } from '@potluck/core'
import { en, t } from '@potluck/i18n'

type CsvStrings = typeof en.transfer.csv

function build(csv: CsvStrings, categories: Record<string, string>): LedgerLabels {
  return {
    date: csv.date,
    group: csv.group,
    type: csv.type,
    description: csv.description,
    category: csv.category,
    amount: csv.amount,
    currency: csv.currency,
    rate: csv.rate,
    groupCurrency: csv.groupCurrency,
    groupAmount: csv.groupAmount,
    paidBy: csv.paidBy,
    notes: csv.notes,
    items: csv.items,
    paid: csv.paid,
    share: csv.share,
    balance: csv.balance,
    between: csv.between,
    kinds: { ...csv.kinds },
    tax: csv.tax,
    tip: csv.tip,
    discount: csv.discount,
    categories,
  }
}

/** Column names in the language the app is showing, for writing a spreadsheet. */
export function ledgerLabels(): LedgerLabels {
  // `t` keeps the placeholder when no value is given, which is what the templates need.
  const keep = { name: '{name}' }
  return build(
    {
      date: t('transfer.csv.date'),
      group: t('transfer.csv.group'),
      type: t('transfer.csv.type'),
      description: t('transfer.csv.description'),
      category: t('transfer.csv.category'),
      amount: t('transfer.csv.amount'),
      currency: t('transfer.csv.currency'),
      rate: t('transfer.csv.rate'),
      groupCurrency: t('transfer.csv.groupCurrency'),
      groupAmount: t('transfer.csv.groupAmount'),
      paidBy: t('transfer.csv.paidBy'),
      notes: t('transfer.csv.notes'),
      items: t('transfer.csv.items'),
      paid: t('transfer.csv.paid', keep),
      share: t('transfer.csv.share', keep),
      balance: t('transfer.csv.balance', keep),
      between: t('transfer.csv.between', keep),
      kinds: {
        expense: t('transfer.csv.kinds.expense'),
        refund: t('transfer.csv.kinds.refund'),
        payment: t('transfer.csv.kinds.payment'),
        balance: t('transfer.csv.kinds.balance'),
      },
      tax: t('transfer.csv.tax'),
      tip: t('transfer.csv.tip'),
      discount: t('transfer.csv.discount'),
    } as CsvStrings,
    Object.fromEntries(CATEGORY_IDS.map((id) => [id, t(`categories.${id}`)])),
  )
}

/**
 * Every set of column names a Potluck spreadsheet may have been written with: the app's
 * language and English, so a file still reads after someone switches language.
 */
export function importLabelSets(): LedgerLabels[] {
  const current = ledgerLabels()
  const english = build(
    en.transfer.csv,
    Object.fromEntries(CATEGORY_IDS.map((id) => [id, en.categories[id]])),
  )
  return current.date === english.date && current.paid === english.paid
    ? [current]
    : [current, english]
}
