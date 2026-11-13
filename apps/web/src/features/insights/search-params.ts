/**
 * Search params for /search and /activity. Imported by route files, so nothing heavy here.
 * Anything malformed is dropped.
 */
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
  const out: MoneySearch = {}
  if (typeof search.q === 'string' && search.q.trim()) out.q = search.q.slice(0, 200)
  const groupId = uuid(search.groupId)
  if (groupId) out.groupId = groupId
  const person = uuid(search.person)
  if (person) out.person = person
  const from = day(search.from)
  if (from) out.from = from
  const to = day(search.to)
  if (to) out.to = to
  if (typeof search.cats === 'string') {
    const cats = search.cats.split(',').filter((c) => CATEGORY.test(c))
    if (cats.length) out.cats = cats.join(',')
  }
  if (search.kind === 'expense' || search.kind === 'payment') out.kind = search.kind
  return out
}

export interface ActivitySearch {
  groupId?: string
  person?: string
}

export function validateActivitySearch(search: Record<string, unknown>): ActivitySearch {
  const out: ActivitySearch = {}
  const groupId = uuid(search.groupId)
  if (groupId) out.groupId = groupId
  const person = uuid(search.person)
  if (person) out.person = person
  return out
}

/** A group's expense list filters, in the Expenses tab's address. */
export type GroupListSearch = Pick<MoneySearch, 'person' | 'from' | 'to' | 'cats'>

export function validateGroupListSearch(search: Record<string, unknown>): GroupListSearch {
  const { person, from, to, cats } = validateMoneySearch(search)
  const out: GroupListSearch = {}
  if (person) out.person = person
  if (from) out.from = from
  if (to) out.to = to
  if (cats) out.cats = cats
  return out
}

export function filtersFromSearch(search: GroupListSearch): MoneyFilters {
  return {
    person: search.person ?? null,
    from: search.from ?? null,
    to: search.to ?? null,
    categories: search.cats ? search.cats.split(',') : [],
  }
}

export function searchFromFilters(filters: MoneyFilters): GroupListSearch {
  return {
    person: filters.person || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    cats: filters.categories?.length ? filters.categories.join(',') : undefined,
  }
}
