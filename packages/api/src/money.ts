/**
 * money queries and mutations. Platform-neutral: no DOM imports.
 */
import { invertRate } from '@potluck/core'
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import type { Database, Json } from './database.types'
import type { PotluckClient } from './index'
import { fetchAllPages, PAGE_SIZE } from './paging'

type Tables = Database['public']['Tables']
export type SplitTypeValue = Database['public']['Enums']['split_type']
export type RecurrenceValue = Database['public']['Enums']['recurrence']
export type GroupRoleValue = Database['public']['Enums']['group_role']

/** An `expenses` row as an RPC returns it (`fx_rate` parsed as a JS number). */
export type ExpenseRow = Tables['expenses']['Row']
/** A `settlements` row as an RPC returns it (`fx_rate` parsed as a JS number). */
export type SettlementRow = Tables['settlements']['Row']

/**
 * Reads select `fx_rate::text`. The column is numeric(24,12): a rate such as
 * 16000.123456789012 has more digits than a JS number keeps, and `convert()` needs every one of
 * them to land on the same cent as the database.
 */
export type Expense = Omit<ExpenseRow, 'fx_rate'> & { fx_rate: string }
export type Settlement = Omit<SettlementRow, 'fx_rate'> & { fx_rate: string }
export type RecurringExpense = Tables['recurring_expenses']['Row']

export interface ExpenseSplit {
  user_id: string
  share_cents: number
  weight: number | null
  /** Adjustment splits: the +/- on top of the equal part. */
  adjustment_cents: number | null
}

/** Who paid (or, for a refund, received) how much, in the expense currency. */
export interface ExpensePayer {
  user_id: string
  paid_cents: number
}

/** One line of a by-item bill, as entered. */
export interface ExpenseItem {
  position: number
  description: string
  amount_cents: number
  user_ids: string[]
}

export interface ExpenseWithSplits extends Expense {
  expense_splits: ExpenseSplit[]
  /** Every payer; sums to `amount_cents`. `paid_by` is whoever paid the most. */
  expense_payers: ExpensePayer[]
  /** By-item expenses only. Sort by `position`. */
  expense_items: ExpenseItem[]
}

/** Where new expenses in a group start (`groups.default_split`). */
export interface DefaultSplit {
  split_type: 'equal' | 'percent' | 'shares'
  splits: { user_id: string; weight: number | null }[]
}

/** An `expense.*` activity row for one expense's history. */
export interface ExpenseHistoryEntry {
  id: string
  actor_id: string | null
  verb: string
  data: Record<string, unknown>
  created_at: string
}

export interface MoneyPerson {
  id: string
  display_name: string
  avatar_path: string | null
  deleted_at: string | null
  /** Added by name, not on Potluck yet (ADR 19). */
  is_placeholder?: boolean
}

export interface MoneyMember extends MoneyPerson {
  role: GroupRoleValue
}

export interface MoneyGroup {
  id: string
  name: string
  emoji: string | null
  color: string | null
  currency: string
  simplify_debts: boolean
  is_direct: boolean
  archived_at: string | null
  members_can_invite: boolean
  default_split: DefaultSplit | null
  members: MoneyMember[]
}

export interface MemberBalance {
  user_id: string
  net_cents: number
}

export interface Debt {
  from_user: string
  to_user: string
  amount_cents: number
}

export interface ExpenseComment {
  id: string
  expense_id: string | null
  author_id: string
  body: string
  created_at: string
}

export interface ActivityItem {
  id: string
  group_id: string
  actor_id: string | null
  verb: string
  subject_id: string | null
  data: Record<string, unknown>
  created_at: string
  actor: Pick<MoneyPerson, 'id' | 'display_name' | 'avatar_path'> | null
  group: { id: string; name: string; emoji: string | null; is_direct: boolean } | null
}

export interface FxQuote {
  /** Units of `to` per unit of `from`, as exact decimal text (numeric(24,12)). */
  rate: string
  day: string
}

/** One person in a `create_expense_v2` / `update_expense_v2` payload. */
export interface ExpenseSplitInput {
  user_id: string
  /** Required for `exact` and `itemized`; ignored by the server for the other types. */
  share_cents?: number
  /** Percent (`percent`) or share count (`shares`). */
  weight?: number
  /** `adjustment`: the +/- on top of an equal share. */
  adjustment_cents?: number
}

/** One line of a by-item bill in a payload; the server works out the shares from these. */
export interface ExpenseItemInput {
  description: string
  amount_cents: number
  user_ids: string[]
}

/** Payload for `create_expense_v2(payload)` (and `update_expense_v2`, minus `group_id`). */
export interface ExpensePayload {
  group_id?: string
  description: string
  amount_cents: number
  currency: string
  /** One payer. With `payers`, the server sets it to whoever paid the most. */
  paid_by: string
  /** Everyone who paid; must add up to `amount_cents`. */
  payers?: ExpensePayer[]
  /** Money coming back: the payers received it and the split is credited. */
  is_refund?: boolean
  split_type: SplitTypeValue
  splits: ExpenseSplitInput[]
  /** By-item bills: stored as entered, and the shares are worked out from them. */
  items?: ExpenseItemInput[]
  tax_cents?: number | null
  tip_cents?: number | null
  discount_cents?: number | null
  category?: string | null
  notes?: string | null
  spent_at: string
  receipt_path?: string | null
  event_id?: string | null
  /** Create only: also saves a recurring template. */
  recurrence?: RecurrenceValue
}

/** `update_expense` takes only the keys that change; leaving out `splits` keeps the stored ones. */
export type ExpenseUpdate = Partial<Omit<ExpensePayload, 'group_id' | 'recurrence'>>

/**
 * Payload for `update_recurring_expense(id, payload)`: the money and details of an expense (no
 * date, receipt or refund) plus the schedule. Notes are copied to every posted expense. Missing keys keep the stored value. Only
 * expenses still to come change.
 */
export type RecurringUpdate = Partial<
  Pick<
    ExpensePayload,
    | 'description'
    | 'amount_cents'
    | 'currency'
    | 'paid_by'
    | 'payers'
    | 'split_type'
    | 'splits'
    | 'items'
    | 'tax_cents'
    | 'tip_cents'
    | 'discount_cents'
    | 'category'
    | 'notes'
  >
> & {
  recurrence?: RecurrenceValue
  /** The next date it posts, today or later. */
  next_run_on?: string
}

export interface SettleUpInput {
  groupId: string
  toUser: string
  amountCents: number
  currency?: string
  note?: string | null
}

export const moneyKeys = {
  all: ['potluck', 'money'] as const,
  people: () => [...moneyKeys.all, 'people'] as const,
  /**
   * The group picker on New expense. Lives under `groupKeys.all` so every group change (create,
   * join, leave, archive, delete) refreshes it with the groups list.
   */
  myGroups: () => ['potluck', 'groups', 'picker', 'money'] as const,
  group: (groupId: string) => [...moneyKeys.all, 'group', groupId] as const,
  groupInfo: (groupId: string) => [...moneyKeys.group(groupId), 'info'] as const,
  expenses: (groupId: string) => [...moneyKeys.group(groupId), 'expenses'] as const,
  settlements: (groupId: string) => [...moneyKeys.group(groupId), 'settlements'] as const,
  balances: (groupId: string) => [...moneyKeys.group(groupId), 'balances'] as const,
  simplified: (groupId: string) => [...moneyKeys.group(groupId), 'simplified'] as const,
  recurring: (groupId: string) => [...moneyKeys.group(groupId), 'recurring'] as const,
  /** One repeating expense, for its editor and the card on a posted copy. */
  recurringOne: (id: string) => [...moneyKeys.all, 'recurring', id] as const,
  /** The currency the viewer last used in a group; refreshed with the group's money. */
  lastCurrency: (groupId: string, userId: string) =>
    [...moneyKeys.group(groupId), 'last-currency', userId] as const,
  expense: (expenseId: string) => [...moneyKeys.all, 'expense', expenseId] as const,
  history: (expenseId: string) => [...moneyKeys.expense(expenseId), 'history'] as const,
  comments: (expenseId: string) => [...moneyKeys.expense(expenseId), 'comments'] as const,
  fxRate: (from: string, to: string, onDay: string) =>
    [...moneyKeys.all, 'fx', from, to, onDay] as const,
  fxCurrencies: (to: string, onDay: string) =>
    [...moneyKeys.all, 'fx-currencies', to, onDay] as const,
  activity: () => [...moneyKeys.all, 'activity'] as const,
  receiptUrl: (path: string) => [...moneyKeys.all, 'receipt', path] as const,
}

/**
 * The stable error code an RPC raised (`splits_sum_mismatch`, `not_allowed`, ...), or null when
 * the error is not one of ours (network, unexpected).
 */
export function moneyErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('message' in error)) return null
  const message = (error as { message: unknown }).message
  return typeof message === 'string' && /^[a-z][a-z0-9_]*$/.test(message) ? message : null
}

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

const PERSON = 'id, display_name, avatar_path, deleted_at, is_placeholder'

// Reads ---------------------------------------------------------------------------------------

/** Everyone the viewer can see (group mates and friends). */
export async function fetchPeople(client: PotluckClient): Promise<MoneyPerson[]> {
  return unwrap(await client.from('profiles').select(PERSON))
}

type GroupSelectRow = Omit<MoneyGroup, 'members'> & {
  group_members: { role: GroupRoleValue; profiles: MoneyPerson | null }[]
}

const GROUP_SELECT = `id, name, emoji, color, currency, simplify_debts, is_direct, archived_at,
  members_can_invite, default_split, group_members (role, profiles (${PERSON}))`

function toGroup(row: GroupSelectRow): MoneyGroup {
  const { group_members, ...group } = row
  return {
    ...group,
    members: group_members
      .filter((m) => m.profiles)
      .map((m) => ({ ...m.profiles!, role: m.role }))
      .sort((a, b) => a.display_name.localeCompare(b.display_name)),
  }
}

/**
 * One group with its members. A group the viewer cannot see (deleted, or never theirs) throws a
 * not found error (`group_not_found`, PT404) without the 406 a `.single()` read would log.
 */
export async function fetchMoneyGroup(client: PotluckClient, groupId: string): Promise<MoneyGroup> {
  const row = unwrap(
    await client.from('groups').select(GROUP_SELECT).eq('id', groupId).maybeSingle(),
  )
  if (!row) throw Object.assign(new Error('group_not_found'), { code: 'PT404' })
  return toGroup(row as unknown as GroupSelectRow)
}

/** Groups the viewer can add expenses to (not archived), alphabetical. */
export async function fetchMoneyGroups(client: PotluckClient): Promise<MoneyGroup[]> {
  const rows = unwrap(
    await client.from('groups').select(GROUP_SELECT).is('archived_at', null).order('name'),
  )
  return (rows as unknown as GroupSelectRow[]).map(toGroup)
}

// Every column, with fx_rate as text (see `Expense`). A column added to the table but not here
// fails typecheck where these rows are returned as `Expense`.
// (One literal each: supabase-js derives the row type from the select string.)
const EXPENSE_SELECT =
  'id, group_id, event_id, description, amount_cents, currency, fx_rate::text, paid_by, split_type, category, notes, spent_at, receipt_path, recurring_id, created_by, created_at, updated_at, deleted_at, is_refund, tax_cents, tip_cents, discount_cents, expense_splits (user_id, share_cents, weight, adjustment_cents), expense_payers (user_id, paid_cents), expense_items (position, description, amount_cents, user_ids)'
const SETTLEMENT_SELECT =
  'id, group_id, from_user, to_user, amount_cents, currency, fx_rate::text, note, settled_at, created_by, created_at, deleted_at'

/** Every live (not deleted) expense, newest first. */
export async function fetchGroupExpenses(
  client: PotluckClient,
  groupId: string,
): Promise<ExpenseWithSplits[]> {
  return fetchAllPages((from, to) =>
    client
      .from('expenses')
      .select(EXPENSE_SELECT)
      .eq('group_id', groupId)
      .is('deleted_at', null)
      .order('spent_at', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to),
  )
}

/** Every live (not deleted) settlement, newest first. */
export async function fetchGroupSettlements(
  client: PotluckClient,
  groupId: string,
): Promise<Settlement[]> {
  return fetchAllPages((from, to) =>
    client
      .from('settlements')
      .select(SETTLEMENT_SELECT)
      .eq('group_id', groupId)
      .is('deleted_at', null)
      .order('settled_at', { ascending: false })
      .order('id')
      .range(from, to),
  )
}

/** Net balance per member in the group currency (positive = is owed). */
export async function fetchGroupBalances(
  client: PotluckClient,
  groupId: string,
): Promise<MemberBalance[]> {
  const rows = unwrap(
    await client.from('group_balances').select('user_id, net_cents').eq('group_id', groupId),
  )
  return rows
    .filter((r): r is { user_id: string; net_cents: number } => r.user_id !== null)
    .map((r) => ({ user_id: r.user_id, net_cents: r.net_cents ?? 0 }))
}

export async function fetchSimplifiedDebts(
  client: PotluckClient,
  groupId: string,
): Promise<Debt[]> {
  return unwrap(await client.rpc('simplified_debts', { group_id: groupId }))
}

/** One expense with its splits, including soft-deleted ones (so they can be restored). */
export async function fetchExpense(
  client: PotluckClient,
  expenseId: string,
): Promise<ExpenseWithSplits> {
  return unwrap(await client.from('expenses').select(EXPENSE_SELECT).eq('id', expenseId).single())
}

export async function fetchExpenseComments(
  client: PotluckClient,
  expenseId: string,
): Promise<ExpenseComment[]> {
  return unwrap(
    await client
      .from('comments')
      .select('id, expense_id, author_id, body, created_at')
      .eq('expense_id', expenseId)
      .is('deleted_at', null)
      .order('created_at'),
  )
}

/** Who added, changed, deleted and restored an expense, oldest first (from `activity`). */
export async function fetchExpenseHistory(
  client: PotluckClient,
  expenseId: string,
): Promise<ExpenseHistoryEntry[]> {
  const rows = unwrap(
    await client
      .from('activity')
      .select('id, actor_id, verb, data, created_at')
      .eq('subject_id', expenseId)
      .like('verb', 'expense.%')
      .order('created_at')
      .order('id'),
  )
  return rows as ExpenseHistoryEntry[]
}

/**
 * The currency of the last expense the viewer added in a group (deleted ones do not count), or
 * null if there is none. New expenses start in it, as in Splitwise.
 */
export async function fetchLastCurrency(
  client: PotluckClient,
  groupId: string,
  userId: string,
): Promise<string | null> {
  const rows = unwrap(
    await client
      .from('expenses')
      .select('currency')
      .eq('group_id', groupId)
      .eq('created_by', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1),
  )
  return rows[0]?.currency ?? null
}

export async function fetchRecurringExpenses(
  client: PotluckClient,
  groupId: string,
): Promise<RecurringExpense[]> {
  return unwrap(
    await client
      .from('recurring_expenses')
      .select('*')
      .eq('group_id', groupId)
      .order('next_run_on'),
  )
}

/**
 * Latest known rate from `from` into `to` on or before `onDay`, trying the inverse pair as a
 * fallback (same lookup as the server's `private.fx_rate`). The server snapshots its own rate
 * on save; this is only a preview.
 */
export async function fetchFxRate(
  client: PotluckClient,
  from: string,
  to: string,
  onDay: string,
): Promise<FxQuote | null> {
  if (from === to) return { rate: '1', day: '' }
  const direct = unwrap(
    await client
      .from('fx_rates')
      .select('rate::text, day')
      .eq('base', from)
      .eq('quote', to)
      .lte('day', onDay)
      .order('day', { ascending: false })
      .limit(1),
  )
  if (direct[0]) return { rate: direct[0].rate, day: direct[0].day }
  const inverse = unwrap(
    await client
      .from('fx_rates')
      .select('rate::text, day')
      .eq('base', to)
      .eq('quote', from)
      .lte('day', onDay)
      .order('day', { ascending: false })
      .limit(1),
  )
  if (inverse[0]) {
    return { rate: invertRate(inverse[0].rate), day: inverse[0].day }
  }
  return null
}

/**
 * Currencies that have a rate into `to` on or before `onDay`, so expenses in them dated
 * `onDay` can be saved. Newest days first: fx-sync writes every pair each day, so the capped
 * response still covers every currency.
 */
export async function fetchFxCurrencies(
  client: PotluckClient,
  to: string,
  onDay: string,
): Promise<string[]> {
  const rows = unwrap(
    await client
      .from('fx_rates')
      .select('base, quote')
      .or(`base.eq.${to},quote.eq.${to}`)
      .lte('day', onDay)
      .order('day', { ascending: false })
      .limit(PAGE_SIZE),
  )
  const set = new Set<string>()
  for (const r of rows) set.add(r.base === to ? r.quote : r.base)
  set.delete(to)
  return [...set].sort()
}

export const ACTIVITY_PAGE_SIZE = 30

/** Where the next activity page starts: just after this row in (created_at, id) order. */
export interface ActivityCursor {
  createdAt: string
  id: string
}

/**
 * Narrows the feed to one group, or to what involves both the viewer and one friend (expenses
 * both are in, payments between them, their one-to-one tab).
 */
export interface ActivityFilter {
  groupId?: string
  friendId?: string
}

/**
 * The feed across every group the viewer is in, newest first. Pass `before` to page. Ordered by
 * (created_at, id) and paged on both, so rows sharing a timestamp are never skipped or repeated.
 */
export async function fetchActivity(
  client: PotluckClient,
  {
    before,
    limit = ACTIVITY_PAGE_SIZE,
    groupId,
    friendId,
  }: { before?: ActivityCursor; limit?: number } & ActivityFilter = {},
): Promise<ActivityItem[]> {
  if (friendId) {
    const rows = unwrap(
      await client.rpc('friend_activity', {
        friend: friendId,
        max_rows: limit,
        ...(before ? { before_at: before.createdAt, before_id: before.id } : {}),
      }),
    )
    return (rows ?? []).map(({ actor_info, group_info, ...row }) => ({
      ...row,
      data: (row.data ?? {}) as Record<string, unknown>,
      actor: actor_info as ActivityItem['actor'],
      group: group_info as ActivityItem['group'],
    }))
  }
  let query = client.from('activity').select(
    `id, group_id, actor_id, verb, subject_id, data, created_at,
      actor:profiles!activity_actor_id_fkey (id, display_name, avatar_path),
      group:groups (id, name, emoji, is_direct)`,
  )
  if (groupId) query = query.eq('group_id', groupId)
  if (before) {
    const at = `"${before.createdAt}"`
    query = query.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt."${before.id}")`)
  }
  const rows = unwrap(
    await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit),
  )
  return rows as unknown as ActivityItem[]
}

/**
 * The feed as an infinite query, shared by the screen and its route loader. A filtered feed
 * lives under the same key prefix, so invalidating `moneyKeys.activity()` refreshes it too.
 */
export const activityInfiniteQueryOptions = (client: PotluckClient, filter: ActivityFilter = {}) =>
  infiniteQueryOptions({
    queryKey:
      filter.groupId || filter.friendId
        ? ([
            ...moneyKeys.activity(),
            { groupId: filter.groupId, friendId: filter.friendId },
          ] as const)
        : moneyKeys.activity(),
    queryFn: ({ pageParam }) => fetchActivity(client, { before: pageParam, ...filter }),
    initialPageParam: undefined as ActivityCursor | undefined,
    getNextPageParam: (last: ActivityItem[]): ActivityCursor | undefined => {
      const tail = last[last.length - 1]
      return last.length < ACTIVITY_PAGE_SIZE || !tail
        ? undefined
        : { createdAt: tail.created_at, id: tail.id }
    },
  })

export async function fetchReceiptUrl(client: PotluckClient, path: string): Promise<string> {
  const data = unwrap(await client.storage.from('receipts').createSignedUrl(path, 60 * 60))
  if (!data?.signedUrl) throw new Error('receipt_unavailable')
  return data.signedUrl
}

/** One repeating expense, or null when it is gone (stopped) or not visible. */
export async function fetchRecurringExpense(
  client: PotluckClient,
  id: string,
): Promise<RecurringExpense | null> {
  return unwrap(await client.from('recurring_expenses').select('*').eq('id', id).maybeSingle())
}

// Writes --------------------------------------------------------------------------------------

export async function createExpense(
  client: PotluckClient,
  payload: ExpensePayload,
): Promise<ExpenseRow> {
  return unwrap(await client.rpc('create_expense_v2', { payload: payload as unknown as Json }))
}

export async function updateExpense(
  client: PotluckClient,
  expenseId: string,
  payload: ExpenseUpdate,
): Promise<ExpenseRow> {
  return unwrap(
    await client.rpc('update_expense_v2', { id: expenseId, payload: payload as unknown as Json }),
  )
}

/**
 * Save where new expenses in a group start, or `null` to go back to equal between everyone.
 * Any member may change it; it never moves a balance.
 */
export async function setDefaultSplit(
  client: PotluckClient,
  groupId: string,
  split: DefaultSplit | null,
): Promise<DefaultSplit | null> {
  const result = unwrap(
    await client.rpc('set_default_split', {
      group_id: groupId,
      split: split as unknown as Json,
    }),
  )
  return (result ?? null) as unknown as DefaultSplit | null
}

export async function deleteExpense(client: PotluckClient, expenseId: string): Promise<ExpenseRow> {
  return unwrap(await client.rpc('delete_expense', { id: expenseId }))
}

export async function restoreExpense(
  client: PotluckClient,
  expenseId: string,
): Promise<ExpenseRow> {
  return unwrap(await client.rpc('restore_expense', { id: expenseId }))
}

/**
 * Clients may only send `expense_id` and `body`: the author defaults to the caller and a
 * trigger copies `group_id` from the expense.
 */
export async function addExpenseComment(
  client: PotluckClient,
  input: { expenseId: string; body: string },
): Promise<ExpenseComment> {
  const row = { expense_id: input.expenseId, body: input.body }
  return unwrap(
    await client
      .from('comments')
      .insert(row as Tables['comments']['Insert'])
      .select('id, expense_id, author_id, body, created_at')
      .single(),
  )
}

export async function deleteExpenseComment(client: PotluckClient, commentId: string) {
  unwrap(
    await client
      .from('comments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', commentId),
  )
}

export async function settleUp(
  client: PotluckClient,
  input: SettleUpInput,
): Promise<SettlementRow> {
  return unwrap(
    await client.rpc('settle_up', {
      group_id: input.groupId,
      to_user: input.toUser,
      amount_cents: input.amountCents,
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.note ? { note: input.note } : {}),
    }),
  )
}

export async function deleteSettlement(client: PotluckClient, settlementId: string) {
  return unwrap(await client.rpc('delete_settlement', { id: settlementId }))
}

export async function setRecurringActive(client: PotluckClient, id: string, active: boolean) {
  unwrap(await client.from('recurring_expenses').update({ active }).eq('id', id))
}

export async function deleteRecurring(client: PotluckClient, id: string) {
  unwrap(await client.from('recurring_expenses').delete().eq('id', id))
}

/** Change a repeating expense; expenses that already posted stay as they are. */
export async function updateRecurring(
  client: PotluckClient,
  id: string,
  payload: RecurringUpdate,
): Promise<RecurringExpense> {
  return unwrap(
    await client.rpc('update_recurring_expense', { id, payload: payload as unknown as Json }),
  )
}

/** Skip the next occurrence: nothing posts for it and the date moves one period on. */
export async function skipRecurring(client: PotluckClient, id: string): Promise<RecurringExpense> {
  return unwrap(await client.rpc('skip_recurring_expense', { id }))
}

/** Make an expense that already happened repeat from now on. */
export async function makeExpenseRecurring(
  client: PotluckClient,
  expenseId: string,
  recurrence: RecurrenceValue,
): Promise<RecurringExpense> {
  return unwrap(await client.rpc('make_expense_recurring', { expense_id: expenseId, recurrence }))
}

type UploadBody = Parameters<ReturnType<PotluckClient['storage']['from']>['upload']>[1]

/**
 * Stores a receipt under `<group_id>/` in the private `receipts` bucket (the path the
 * expense RPCs and storage policies require) and returns its path.
 */
export async function uploadReceipt(
  client: PotluckClient,
  groupId: string,
  body: UploadBody,
  { extension, contentType }: { extension: string; contentType?: string },
): Promise<string> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const path = `${groupId}/${id}.${extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg'}`
  unwrap(await client.storage.from('receipts').upload(path, body, { contentType, upsert: false }))
  return path
}

// Query options -------------------------------------------------------------------------------

export const moneyQueries = {
  people: (client: PotluckClient) =>
    queryOptions({ queryKey: moneyKeys.people(), queryFn: () => fetchPeople(client) }),
  myGroups: (client: PotluckClient) =>
    queryOptions({ queryKey: moneyKeys.myGroups(), queryFn: () => fetchMoneyGroups(client) }),
  group: (client: PotluckClient, groupId: string) =>
    queryOptions({
      queryKey: moneyKeys.groupInfo(groupId),
      queryFn: () => fetchMoneyGroup(client, groupId),
    }),
  expenses: (client: PotluckClient, groupId: string) =>
    queryOptions({
      queryKey: moneyKeys.expenses(groupId),
      queryFn: () => fetchGroupExpenses(client, groupId),
    }),
  settlements: (client: PotluckClient, groupId: string) =>
    queryOptions({
      queryKey: moneyKeys.settlements(groupId),
      queryFn: () => fetchGroupSettlements(client, groupId),
    }),
  balances: (client: PotluckClient, groupId: string) =>
    queryOptions({
      queryKey: moneyKeys.balances(groupId),
      queryFn: () => fetchGroupBalances(client, groupId),
    }),
  simplified: (client: PotluckClient, groupId: string) =>
    queryOptions({
      queryKey: moneyKeys.simplified(groupId),
      queryFn: () => fetchSimplifiedDebts(client, groupId),
    }),
  recurring: (client: PotluckClient, groupId: string) =>
    queryOptions({
      queryKey: moneyKeys.recurring(groupId),
      queryFn: () => fetchRecurringExpenses(client, groupId),
    }),
  recurringOne: (client: PotluckClient, id: string) =>
    queryOptions({
      queryKey: moneyKeys.recurringOne(id),
      queryFn: () => fetchRecurringExpense(client, id),
    }),
  expense: (client: PotluckClient, expenseId: string) =>
    queryOptions({
      queryKey: moneyKeys.expense(expenseId),
      queryFn: () => fetchExpense(client, expenseId),
    }),
  history: (client: PotluckClient, expenseId: string) =>
    queryOptions({
      queryKey: moneyKeys.history(expenseId),
      queryFn: () => fetchExpenseHistory(client, expenseId),
    }),
  lastCurrency: (client: PotluckClient, groupId: string, userId: string) =>
    queryOptions({
      queryKey: moneyKeys.lastCurrency(groupId, userId),
      queryFn: () => fetchLastCurrency(client, groupId, userId),
    }),
  comments: (client: PotluckClient, expenseId: string) =>
    queryOptions({
      queryKey: moneyKeys.comments(expenseId),
      queryFn: () => fetchExpenseComments(client, expenseId),
    }),
  fxRate: (client: PotluckClient, from: string, to: string, onDay: string) =>
    queryOptions({
      queryKey: moneyKeys.fxRate(from, to, onDay),
      queryFn: () => fetchFxRate(client, from, to, onDay),
      staleTime: 60 * 60 * 1000,
    }),
  fxCurrencies: (client: PotluckClient, to: string, onDay: string) =>
    queryOptions({
      queryKey: moneyKeys.fxCurrencies(to, onDay),
      queryFn: () => fetchFxCurrencies(client, to, onDay),
      staleTime: 60 * 60 * 1000,
    }),
  receiptUrl: (client: PotluckClient, path: string) =>
    queryOptions({
      queryKey: moneyKeys.receiptUrl(path),
      queryFn: () => fetchReceiptUrl(client, path),
      staleTime: 50 * 60 * 1000,
    }),
}
