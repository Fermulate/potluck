import type { LedgerLabels } from './ledger'

/** Column names for tests (the app passes the ones from i18n). */
export const TEST_LABELS: LedgerLabels = {
  date: 'Date',
  group: 'Group',
  type: 'Type',
  description: 'Description',
  category: 'Category',
  amount: 'Amount',
  currency: 'Currency',
  rate: 'Rate',
  groupCurrency: 'Group currency',
  groupAmount: 'Amount in group currency',
  paidBy: 'Paid by',
  notes: 'Notes',
  items: 'Items',
  paid: '{name} paid',
  share: '{name} share',
  balance: '{name} balance',
  between: 'Between you and {name}',
  kinds: { expense: 'Expense', refund: 'Refund', payment: 'Payment', balance: 'Balance' },
  tax: 'Tax',
  tip: 'Tip',
  discount: 'Discount',
  categories: { food: 'Food', groceries: 'Groceries', other: 'Other' },
}

/** The same columns in another language, to check the reader takes any of the sets it is given. */
export const TEST_LABELS_ES: LedgerLabels = {
  ...TEST_LABELS,
  date: 'Fecha',
  group: 'Grupo',
  type: 'Tipo',
  description: 'Descripción',
  paid: '{name} pagó',
  share: 'Parte de {name}',
  balance: 'Saldo de {name}',
  kinds: { expense: 'Gasto', refund: 'Reembolso', payment: 'Pago', balance: 'Saldo' },
}

// A group export as Splitwise's web app writes it (Group page, "Export as spreadsheet").
export const SPLITWISE_EXPORT = [
  'Date,Description,Category,Cost,Currency,Ava Smith,Ben Jones,Cleo Park',
  '2026-03-01,Dinner,Dining out,90.00,USD,60.00,-30.00,-30.00',
  '2026-03-02,"Groceries, big shop",Groceries,45.00,USD,-15.00,30.00,-15.00',
  '2026-03-03,Ben J. paid Ava S.,Payment,30.00,USD,-30.00,30.00,0.00',
  '2026-03-04,Returned tickets,Movies,30.00,USD,-20.00,10.00,10.00',
  '2026-03-05,Coffee for me,General,4.50,USD,0.00,0.00,0.00',
  '',
  '2026-03-05,Total balance, , ,USD,-5.00,40.00,-35.00',
  '',
].join('\n')
