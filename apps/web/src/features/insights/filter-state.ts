import { monthEnd, previousMonth, type ExpenseFilters } from '@potluck/core'
import type { SearchKind } from '@potluck/api'
import { formatDate, t } from '@potluck/i18n'
import { categoryLabel } from '@/features/expenses/format'

/** Everything the filter sheet edits. Search adds a group and a type; a group's list does not. */
export interface MoneyFilters extends ExpenseFilters {
  groupId?: string | null
  kind?: SearchKind | null
}

export type DatePreset = 'thisMonth' | 'lastMonth' | 'thisYear'

/** Inclusive day bounds of a preset, counted from `today` (`YYYY-MM-DD` in the viewer's zone). */
export function presetRange(preset: DatePreset, today: string): { from: string; to: string } {
  const month = `${today.slice(0, 7)}-01`
  switch (preset) {
    case 'thisMonth':
      return { from: month, to: monthEnd(month) }
    case 'lastMonth': {
      const last = previousMonth(month)
      return { from: last, to: monthEnd(last) }
    }
    case 'thisYear':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` }
  }
}

/** The preset the range is exactly, if any. */
export function matchingPreset(
  filters: Pick<ExpenseFilters, 'from' | 'to'>,
  today: string,
): DatePreset | null {
  for (const preset of ['thisMonth', 'lastMonth', 'thisYear'] as const) {
    const range = presetRange(preset, today)
    if (filters.from === range.from && filters.to === range.to) return preset
  }
  return null
}

/** "This month", "Mar 1 to Mar 9", "Since Mar 1", or null with no dates. */
export function dateLabel(filters: Pick<ExpenseFilters, 'from' | 'to'>, today: string) {
  if (!filters.from && !filters.to) return null
  const preset = matchingPreset(filters, today)
  if (preset) return t(`filters.${preset}`)
  const fmt = (day: string) => formatDate(day, { timeZone: 'UTC', style: 'medium' })
  if (filters.from && filters.to)
    return t('filters.range', { from: fmt(filters.from), to: fmt(filters.to) })
  if (filters.from) return t('filters.since', { from: fmt(filters.from) })
  return t('filters.until', { to: fmt(filters.to!) })
}

export interface ActiveFilter {
  key: 'dates' | 'person' | 'category' | 'group' | 'kind'
  /** For categories, which one. */
  value?: string
  label: string
}

/** One removable chip per active filter, in sheet order. */
export function activeFilters(
  filters: MoneyFilters,
  {
    today,
    personName,
    groupName,
  }: {
    today: string
    personName: (id: string) => string
    groupName?: (id: string) => string
  },
): ActiveFilter[] {
  const chips: ActiveFilter[] = []
  const dates = dateLabel(filters, today)
  if (dates) chips.push({ key: 'dates', label: dates })
  if (filters.person) chips.push({ key: 'person', label: personName(filters.person) })
  for (const category of filters.categories ?? []) {
    chips.push({ key: 'category', value: category, label: categoryLabel(category) })
  }
  if (filters.groupId && groupName) chips.push({ key: 'group', label: groupName(filters.groupId) })
  if (filters.kind) {
    chips.push({
      key: 'kind',
      label: t(filters.kind === 'expense' ? 'filters.expenses' : 'filters.payments'),
    })
  }
  return chips
}

/** The filters without the one a chip stands for. */
export function withoutFilter(filters: MoneyFilters, chip: ActiveFilter): MoneyFilters {
  switch (chip.key) {
    case 'dates':
      return { ...filters, from: null, to: null }
    case 'person':
      return { ...filters, person: null }
    case 'category':
      return { ...filters, categories: (filters.categories ?? []).filter((c) => c !== chip.value) }
    case 'group':
      return { ...filters, groupId: null }
    case 'kind':
      return { ...filters, kind: null }
  }
}

export function countFilters(filters: MoneyFilters): number {
  return (
    (filters.from || filters.to ? 1 : 0) +
    (filters.person ? 1 : 0) +
    (filters.categories?.length ?? 0) +
    (filters.groupId ? 1 : 0) +
    (filters.kind ? 1 : 0)
  )
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A `YYYY-MM-DD` search param, or undefined. */
export function dayParam(value: unknown): string | undefined {
  return typeof value === 'string' && DAY.test(value) ? value : undefined
}
