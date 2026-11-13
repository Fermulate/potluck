import { previousMonth, type SpendingRow } from '@potluck/core'

export type PeriodKind = 'month' | 'year' | 'all'

export interface Period {
  kind: PeriodKind
  /** `YYYY-MM-01`: the month shown, or any month of the year shown. */
  month: string
}

/** Rows inside the period (months are whole, so this is a plain string compare). */
export function rowsInPeriod<T extends Pick<SpendingRow, 'month'>>(
  rows: readonly T[],
  period: Period,
): T[] {
  if (period.kind === 'all') return [...rows]
  if (period.kind === 'year')
    return rows.filter((r) => r.month.slice(0, 4) === period.month.slice(0, 4))
  return rows.filter((r) => r.month === period.month)
}

/** The months the column chart shows for a period. */
export function chartMonths(
  rows: readonly Pick<SpendingRow, 'month'>[],
  period: Period,
  thisMonth: string,
) {
  if (period.kind === 'year') {
    const year = period.month.slice(0, 4)
    return { from: `${year}-01-01`, to: `${year}-12-01` }
  }
  if (period.kind === 'all') {
    const first = rows.reduce((min, r) => (r.month < min ? r.month : min), thisMonth)
    const last = rows.reduce((max, r) => (r.month > max ? r.month : max), thisMonth)
    return { from: first, to: last }
  }
  let from = period.month
  for (let i = 0; i < 11; i++) from = previousMonth(from)
  return { from, to: period.month }
}
