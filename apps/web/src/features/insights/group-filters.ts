import type { GroupListSearch } from './search-params'

/**
 * The last filters used on each group's Expenses tab, for this visit. The filters live in the
 * Expenses tab's address only; the tab link reads them back from here, so going to Balances or
 * Totals and back keeps them without putting them on those addresses.
 */
const remembered = new Map<string, GroupListSearch>()

export function rememberGroupFilters(groupId: string, search: GroupListSearch) {
  if (search.person || search.from || search.to || search.cats) remembered.set(groupId, search)
  else remembered.delete(groupId)
}

export function recallGroupFilters(groupId: string): GroupListSearch {
  return remembered.get(groupId) ?? {}
}
