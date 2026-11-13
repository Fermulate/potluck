/**
 * Search, spending totals and the deleted items list. Platform-neutral: no DOM imports.
 *
 * Reads go through `search_money` and `spending_summary` (security definer RPCs that check
 * membership), so nothing here scans tables on the client.
 */
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import type { Database } from './database.types'
import type { PotluckClient } from './index'
import { moneyKeys } from './money'
import { fetchAllPages } from './paging'

type SearchArgs = Database['public']['Functions']['search_money']['Args']
type SearchRow = Database['public']['Functions']['search_money']['Returns'][number]
type SummaryRow = Database['public']['Functions']['spending_summary']['Returns'][number]

export type SearchKind = 'expense' | 'payment'
export type SearchMatch = 'description' | 'notes' | 'comment' | 'person' | 'amount'

/** One expense or payment from `search_money`. */
export interface SearchHit {
  kind: SearchKind
  id: string
  groupId: string
  /** Calendar day: `spent_at`, or the payment's day in the viewer's zone. */
  day: string
  /** `created_at` for expenses, `settled_at` for payments. */
  at: string
  /** Expense description, or the payment note. */
  description: string | null
  category: string | null
  amountCents: number
  currency: string
  groupCurrency: string
  /** The amount converted into the group currency. */
  groupAmountCents: number
  /** Who paid (the payer of an expense, the sender of a payment). */
  paidBy: string
  /** Payments only: who received it. */
  toUser: string | null
  createdBy: string | null
  /** Expenses only, group currency; null when the viewer is not in it or it is deleted. */
  myPaidCents: number | null
  myShareCents: number | null
  deletedAt: string | null
  /** Why it matched, when there was a query. */
  matched: SearchMatch | null
  /** The comment or name that matched, when that was the reason. */
  snippet: string | null
  /** Everyone who paid, most first (the sender, for a payment). */
  payers: string[]
  /** Money that came back: the payers got it. */
  isRefund: boolean
}

export interface SearchFilters {
  query?: string
  groupId?: string
  /** Someone who paid or is in the split (or either side of a payment). */
  person?: string
  /** Inclusive calendar days, `YYYY-MM-DD`. */
  from?: string
  to?: string
  categories?: readonly string[]
  kinds?: readonly SearchKind[]
}

/** Where the next page starts: just after this row in (day, at, id) order. */
export interface SearchCursor {
  day: string
  at: string
  id: string
}

export const SEARCH_PAGE_SIZE = 40

export const insightsKeys = {
  all: [...moneyKeys.all, 'insights'] as const,
  search: (filters: SearchFilters) => [...insightsKeys.all, 'search', normalize(filters)] as const,
  /** Lives under the group's money key, so every money change in the group refreshes it. */
  groupSpending: (groupId: string, from: string | null, to: string | null) =>
    [...moneyKeys.group(groupId), 'spending', from, to] as const,
  spending: (from: string | null, to: string | null, inCurrency: string | null = null) =>
    [...insightsKeys.all, 'spending', from, to, inCurrency] as const,
  deleted: (groupId: string) => [...moneyKeys.group(groupId), 'deleted'] as const,
}

function normalize(filters: SearchFilters) {
  return {
    query: filters.query?.trim() || undefined,
    groupId: filters.groupId,
    person: filters.person,
    from: filters.from,
    to: filters.to,
    categories: filters.categories?.length ? [...filters.categories].sort() : undefined,
    kinds: filters.kinds?.length ? [...filters.kinds].sort() : undefined,
  }
}

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

function toHit(row: SearchRow): SearchHit {
  return {
    kind: row.kind as SearchKind,
    id: row.id,
    groupId: row.group_id,
    day: row.day,
    at: row.at,
    description: row.description,
    category: row.category,
    amountCents: row.amount_cents,
    currency: row.currency,
    groupCurrency: row.group_currency,
    groupAmountCents: row.group_amount_cents,
    paidBy: row.paid_by,
    toUser: row.to_user,
    createdBy: row.created_by,
    myPaidCents: row.my_paid_cents,
    myShareCents: row.my_share_cents,
    deletedAt: row.deleted_at,
    matched: row.matched as SearchMatch | null,
    snippet: row.snippet,
    payers: row.payers ?? [row.paid_by],
    isRefund: row.is_refund ?? false,
  }
}

/** One page of expenses and payments matching `filters`, newest first. */
export async function searchMoney(
  client: PotluckClient,
  filters: SearchFilters,
  { before, limit = SEARCH_PAGE_SIZE }: { before?: SearchCursor; limit?: number } = {},
): Promise<SearchHit[]> {
  const f = normalize(filters)
  const args: SearchArgs = { max_rows: limit }
  if (f.query) args.query = f.query
  if (f.groupId) args.in_group = f.groupId
  if (f.person) args.person = f.person
  if (f.from) args.from_day = f.from
  if (f.to) args.to_day = f.to
  if (f.categories) args.categories = f.categories
  if (f.kinds) args.kinds = f.kinds
  if (before) {
    args.before_day = before.day
    args.before_at = before.at
    args.before_id = before.id
  }
  const rows = unwrap(await client.rpc('search_money', args))
  return (rows ?? []).map(toHit)
}

const nextCursor =
  (pageSize: number) =>
  (last: SearchHit[]): SearchCursor | undefined => {
    const tail = last[last.length - 1]
    return last.length < pageSize || !tail ? undefined : { day: tail.day, at: tail.at, id: tail.id }
  }

/** Search as an infinite query: each page continues after the last row of the one before. */
export const searchInfiniteQueryOptions = (client: PotluckClient, filters: SearchFilters) =>
  infiniteQueryOptions({
    queryKey: insightsKeys.search(filters),
    queryFn: ({ pageParam }) => searchMoney(client, filters, { before: pageParam }),
    initialPageParam: undefined as SearchCursor | undefined,
    getNextPageParam: nextCursor(SEARCH_PAGE_SIZE),
  })

type DeletedRow = Database['public']['Functions']['deleted_items']['Returns'][number]

/** A deleted expense or payment, from `deleted_items`. */
export interface DeletedItem {
  kind: SearchKind
  id: string
  groupId: string
  /** The expense's date, or the payment's day in the viewer's zone. */
  day: string
  /** Expense description, or the payment note. */
  description: string | null
  category: string | null
  amountCents: number
  currency: string
  paidBy: string
  toUser: string | null
  createdBy: string | null
  deletedAt: string
  /** Who deleted it, from the feed; null if the feed has no record. */
  deletedBy: string | null
  /** Everyone who paid (the sender, for a payment). */
  payers: string[]
}

export interface DeletedCursor {
  deletedAt: string
  id: string
}

export const DELETED_PAGE_SIZE = 40

function toDeletedItem(row: DeletedRow): DeletedItem {
  return {
    kind: row.kind as SearchKind,
    id: row.id,
    groupId: row.group_id,
    day: row.day,
    description: row.description,
    category: row.category,
    amountCents: row.amount_cents,
    currency: row.currency,
    paidBy: row.paid_by,
    toUser: row.to_user,
    createdBy: row.created_by,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    payers: row.payers ?? [row.paid_by],
  }
}

/** One page of a group's deleted expenses and payments, most recently deleted first. */
export async function fetchDeletedItems(
  client: PotluckClient,
  groupId: string,
  { before, limit = DELETED_PAGE_SIZE }: { before?: DeletedCursor; limit?: number } = {},
): Promise<DeletedItem[]> {
  const rows = unwrap(
    await client.rpc('deleted_items', {
      in_group: groupId,
      max_rows: limit,
      ...(before ? { before_at: before.deletedAt, before_id: before.id } : {}),
    }),
  )
  return (rows ?? []).map(toDeletedItem)
}

/** A group's deleted items as an infinite query, under the group's money key. */
export const deletedItemsInfiniteQueryOptions = (client: PotluckClient, groupId: string) =>
  infiniteQueryOptions({
    queryKey: insightsKeys.deleted(groupId),
    queryFn: ({ pageParam }) => fetchDeletedItems(client, groupId, { before: pageParam }),
    initialPageParam: undefined as DeletedCursor | undefined,
    getNextPageParam: (last: DeletedItem[]): DeletedCursor | undefined => {
      const tail = last[last.length - 1]
      return last.length < DELETED_PAGE_SIZE || !tail
        ? undefined
        : { deletedAt: tail.deletedAt, id: tail.id }
    },
  })

/** One row of `spending_summary`, shaped like `SpendingRow` in `@potluck/core`. */
export interface SpendingSummaryRow {
  groupId: string
  currency: string
  month: string
  category: string | null
  expenseCount: number
  spendCents: number
  paidCents: number
  shareCents: number
  paymentsMadeCents: number
  paymentsReceivedCents: number
  unconvertedCount: number
}

function toSummaryRow(row: SummaryRow): SpendingSummaryRow {
  return {
    groupId: row.group_id,
    currency: row.currency,
    month: row.month,
    category: row.category,
    expenseCount: row.expense_count,
    spendCents: row.spend_cents,
    paidCents: row.paid_cents,
    shareCents: row.share_cents,
    paymentsMadeCents: row.payments_made_cents,
    paymentsReceivedCents: row.payments_received_cents,
    unconvertedCount: row.unconverted_count,
  }
}

/**
 * The viewer's spending per group, month and category in group currency, or all converted into
 * `inCurrency` at each expense's date. Without a group, every group the viewer is in. `from` and
 * `to` are inclusive calendar days.
 */
export async function fetchSpendingSummary(
  client: PotluckClient,
  {
    groupId,
    from,
    to,
    inCurrency,
  }: {
    groupId?: string
    from?: string | null
    to?: string | null
    inCurrency?: string | null
  } = {},
): Promise<SpendingSummaryRow[]> {
  const args: Database['public']['Functions']['spending_summary']['Args'] = {}
  if (groupId) args.in_group = groupId
  if (from) args.from_day = from
  if (to) args.to_day = to
  if (inCurrency) args.in_currency = inCurrency
  // A year across a dozen groups can pass PostgREST's row cap; the rows come back in a total
  // order (month, group, category), so they page safely.
  const rows = await fetchAllPages((first, last) =>
    client.rpc('spending_summary', args).range(first, last),
  )
  return rows.map(toSummaryRow)
}

export const insightsQueries = {
  groupSpending: (
    client: PotluckClient,
    groupId: string,
    from: string | null = null,
    to: string | null = null,
  ) =>
    queryOptions({
      queryKey: insightsKeys.groupSpending(groupId, from, to),
      queryFn: () => fetchSpendingSummary(client, { groupId, from, to }),
    }),
  spending: (
    client: PotluckClient,
    from: string | null = null,
    to: string | null = null,
    inCurrency: string | null = null,
  ) =>
    queryOptions({
      queryKey: insightsKeys.spending(from, to, inCurrency),
      queryFn: () => fetchSpendingSummary(client, { from, to, inCurrency }),
    }),
}
