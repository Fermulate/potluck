import { withSubcategories } from '../categories'

/** Filters shared by a group's expense list and search (`search_money` applies the same ones). */
export interface ExpenseFilters {
  /** Inclusive calendar days, `YYYY-MM-DD`. */
  from?: string | null
  to?: string | null
  /** Someone who paid or is in the split. */
  person?: string | null
  /** Category ids, each top level one with its subcategories; no category counts as `other`. */
  categories?: readonly string[] | null
}

export interface FilterableExpense {
  paidBy: string
  /** Everyone who paid, when there were several (`expense_payers`). */
  payers?: readonly { userId: string }[]
  spentAt: string
  category?: string | null
  splits: readonly { userId: string }[]
}

/** True when nothing is being filtered. */
export function noFilters(filters: ExpenseFilters): boolean {
  return !filters.from && !filters.to && !filters.person && !filters.categories?.length
}

export function matchesExpenseFilters(
  expense: FilterableExpense,
  filters: ExpenseFilters,
): boolean {
  if (filters.from && expense.spentAt < filters.from) return false
  if (filters.to && expense.spentAt > filters.to) return false
  if (
    filters.categories?.length &&
    !withSubcategories(filters.categories).includes(expense.category || 'other')
  ) {
    return false
  }
  if (
    filters.person &&
    expense.paidBy !== filters.person &&
    !expense.payers?.some((p) => p.userId === filters.person) &&
    !expense.splits.some((s) => s.userId === filters.person)
  ) {
    return false
  }
  return true
}

export interface FilterablePayment {
  fromUser: string
  toUser: string
  /** The payment's calendar day in the viewer's zone, `YYYY-MM-DD`. */
  day: string
}

/**
 * Whether a payment passes the filters, as `search_money` decides: either person counts, the
 * day is the payment's, and any category leaves payments out.
 */
export function matchesPaymentFilters(
  payment: FilterablePayment,
  filters: ExpenseFilters,
): boolean {
  if (filters.categories?.length) return false
  if (filters.from && payment.day < filters.from) return false
  if (filters.to && payment.day > filters.to) return false
  if (filters.person && payment.fromUser !== filters.person && payment.toUser !== filters.person) {
    return false
  }
  return true
}
