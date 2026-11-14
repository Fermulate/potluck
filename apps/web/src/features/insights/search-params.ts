/**
 * Search params for /search and /activity. Imported by route files, so nothing heavy here.
 * Anything malformed is dropped, and every key is returned (undefined when dropped) so the raw
 * value can never show through (see `src/lib/search.ts`).
 */
import { textValue } from '@/lib/search'
import type { MoneyFilters } from './filter-state'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
const CATEGORY = /^[a-z_]{1,32}$/

const uuid = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : undefined)
const day = (v: unknown) => (typeof v === 'string' && DAY.test(v) ? v : undefined)

export interface MoneySearch {
  q?: string
  groupId?: string
  person?: string
  from?: string
  to?: string
  /** Category ids, comma separated. */
  cats?: string
  kind?: 'expense' | 'payment'
}

export function validateMoneySearch(search: Record<string, unknown>): MoneySearch {
  // `?q=30` is read as the number 30: it was typed as text, so search for "30".
  const q = textValue(search.q)
  const cats =
    typeof search.cats === 'string'
      ? search.cats
          .split(',')
          .filter((c) => CATEGORY.test(c))
          .join(',')
      : ''
  return {
    q: q?.trim() ? q.slice(0, 200) : undefined,
    groupId: uuid(search.groupId),
    person: uuid(search.person),
    from: day(search.from),
    to: day(search.to),
    cats: cats || undefined,
    kind: search.kind === 'expense' || search.kind === 'payment' ? search.kind : undefined,
  }
}

export interface ActivitySearch {
  groupId?: string
  person?: string
}

export function validateActivitySearch(search: Record<string, unknown>): ActivitySearch {
  return { groupId: uuid(search.groupId), person: uuid(search.person) }
}

/** A group's expense list filters, in the Expenses tab's address. */
export type GroupListSearch = Pick<MoneySearch, 'person' | 'from' | 'to' | 'cats' | 'kind'>

export function validateGroupListSearch(search: Record<string, unknown>): GroupListSearch {
  const { person, from, to, cats, kind } = validateMoneySearch(search)
  return { person, from, to, cats, kind }
}

export function filtersFromSearch(search: GroupListSearch): MoneyFilters {
  return {
    person: search.person ?? null,
    from: search.from ?? null,
    to: search.to ?? null,
    categories: search.cats ? search.cats.split(',') : [],
    kind: search.kind ?? null,
  }
}

export function searchFromFilters(filters: MoneyFilters): GroupListSearch {
  return {
    person: filters.person || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    cats: filters.categories?.length ? filters.categories.join(',') : undefined,
    kind: filters.kind || undefined,
  }
}
