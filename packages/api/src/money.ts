/**
 * money queries and mutations. Platform-neutral: no DOM imports.
 */
import { queryOptions } from '@tanstack/react-query'
import type { Database, Json } from './database.types'
import type { PotluckClient } from './index'

type Tables = Database['public']['Tables']
export type SplitTypeValue = Database['public']['Enums']['split_type']
export type RecurrenceValue = Database['public']['Enums']['recurrence']
export type GroupRoleValue = Database['public']['Enums']['group_role']

export type Expense = Tables['expenses']['Row']
export type Settlement = Tables['settlements']['Row']
export type RecurringExpense = Tables['recurring_expenses']['Row']

export interface ExpenseSplit {
  user_id: string
  share_cents: number
  weight: number | null
}

export interface ExpenseWithSplits extends Expense {
  expense_splits: ExpenseSplit[]
}

export interface MoneyPerson {
  id: string
  display_name: string
  avatar_path: string | null
  deleted_at: string | null
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

export interface Viewer extends MoneyPerson {
  timezone: string
  default_currency: string
  locale: string
}

export interface FxQuote {
  /** Units of `to` per unit of `from`. */
  rate: number
  day: string
}

/** One person in a `create_expense` / `update_expense` payload. */
export interface ExpenseSplitInput {
  user_id: string
  /** Required for `exact` and `itemized`; ignored by the server for the other types. */
  share_cents?: number
  /** Percent (`percent`) or share count (`shares`). */
  weight?: number
}

/** Payload for `create_expense(payload)` (and `update_expense`, minus `group_id`). */
export interface ExpensePayload {
  group_id?: string
  description: string
  amount_cents: number
  currency: string
  paid_by: string
  split_type: SplitTypeValue
  splits: ExpenseSplitInput[]
  category?: string | null
  notes?: string | null
  spent_at: string
  receipt_path?: string | null
  event_id?: string | null
  /** Create only: also saves a recurring template. */
  recurrence?: RecurrenceValue
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
  viewer: () => [...moneyKeys.all, 'viewer'] as const,
  people: () => [...moneyKeys.all, 'people'] as const,
  myGroups: () => [...moneyKeys.all, 'my-groups'] as const,
  group: (groupId: string) => [...moneyKeys.all, 'group', groupId] as const,
  groupInfo: (groupId: string) => [...moneyKeys.group(groupId), 'info'] as const,
  expenses: (groupId: string) => [...moneyKeys.group(groupId), 'expenses'] as const,
  settlements: (groupId: string) => [...moneyKeys.group(groupId), 'settlements'] as const,
  balances: (groupId: string) => [...moneyKeys.group(groupId), 'balances'] as const,
  simplified: (groupId: string) => [...moneyKeys.group(groupId), 'simplified'] as const,
  recurring: (groupId: string) => [...moneyKeys.group(groupId), 'recurring'] as const,
  expense: (expenseId: string) => [...moneyKeys.all, 'expense', expenseId] as const,
  comments: (expenseId: string) => [...moneyKeys.expense(expenseId), 'comments'] as const,
  fxRate: (from: string, to: string) => [...moneyKeys.all, 'fx', from, to] as const,
  fxCurrencies: (to: string) => [...moneyKeys.all, 'fx-currencies', to] as const,
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

const PERSON = 'id, display_name, avatar_path, deleted_at'

// Reads ---------------------------------------------------------------------------------------

export async function fetchViewer(client: PotluckClient): Promise<Viewer | null> {
  const { data: auth } = await client.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return null
  return unwrap(
    await client
      .from('profiles')
      .select(`${PERSON}, timezone, default_currency, locale`)
      .eq('id', uid)
      .single(),
  )
}

/** Everyone the viewer can see (group mates and friends). */
export async function fetchPeople(client: PotluckClient): Promise<MoneyPerson[]> {
  return unwrap(await client.from('profiles').select(PERSON))
}

type GroupSelectRow = Omit<MoneyGroup, 'members'> & {
  group_members: { role: GroupRoleValue; profiles: MoneyPerson | null }[]
}

const GROUP_SELECT = `id, name, emoji, color, currency, simplify_debts, is_direct, archived_at,
  group_members (role, profiles (${PERSON}))`

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

export async function fetchMoneyGroup(client: PotluckClient, groupId: string): Promise<MoneyGroup> {
  const row = unwrap(await client.from('groups').select(GROUP_SELECT).eq('id', groupId).single())
  return toGroup(row as unknown as GroupSelectRow)
}

/** Groups the viewer can add expenses to (not archived), alphabetical. */
export async function fetchMyGroups(client: PotluckClient): Promise<MoneyGroup[]> {
  const rows = unwrap(
    await client.from('groups').select(GROUP_SELECT).is('archived_at', null).order('name'),
  )
  return (rows as unknown as GroupSelectRow[]).map(toGroup)
}

const EXPENSE_SELECT = '*, expense_splits (user_id, share_cents, weight)'

/** Live (not deleted) expenses, newest first. */
export async function fetchGroupExpenses(
  client: PotluckClient,
  groupId: string,
): Promise<ExpenseWithSplits[]> {
  return unwrap(
    await client
      .from('expenses')
      .select(EXPENSE_SELECT)
      .eq('group_id', groupId)
      .is('deleted_at', null)
      .order('spent_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(2000),
  )
}

export async function fetchGroupSettlements(
  client: PotluckClient,
  groupId: string,
): Promise<Settlement[]> {
  return unwrap(
    await client
      .from('settlements')
      .select('*')
      .eq('group_id', groupId)
      .is('deleted_at', null)
      .order('settled_at', { ascending: false })
      .limit(2000),
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
 * Latest known rate from `from` into `to`, trying the inverse pair as a fallback (same lookup
 * as the server). The server snapshots its own rate on save; this is only a preview.
 */
export async function fetchLatestFxRate(
  client: PotluckClient,
  from: string,
  to: string,
): Promise<FxQuote | null> {
  if (from === to) return { rate: 1, day: '' }
  const direct = unwrap(
    await client
      .from('fx_rates')
      .select('rate, day')
      .eq('base', from)
      .eq('quote', to)
      .order('day', { ascending: false })
      .limit(1),
  )
  if (direct[0]) return { rate: Number(direct[0].rate), day: direct[0].day }
  const inverse = unwrap(
    await client
      .from('fx_rates')
      .select('rate, day')
      .eq('base', to)
      .eq('quote', from)
      .order('day', { ascending: false })
      .limit(1),
  )
  if (inverse[0]) {
    return { rate: Math.round((1 / Number(inverse[0].rate)) * 1e8) / 1e8, day: inverse[0].day }
  }
  return null
}

/** Currencies that have a rate into `to`, so expenses in them can be saved. */
export async function fetchFxCurrencies(client: PotluckClient, to: string): Promise<string[]> {
  const rows = unwrap(
    await client
      .from('fx_rates')
      .select('base, quote')
      .or(`base.eq.${to},quote.eq.${to}`)
      .limit(5000),
  )
  const set = new Set<string>()
  for (const r of rows) set.add(r.base === to ? r.quote : r.base)
  set.delete(to)
  return [...set].sort()
}

export const ACTIVITY_PAGE_SIZE = 30

/** The feed across every group the viewer is in, newest first. Pass `before` to page. */
export async function fetchActivity(
  client: PotluckClient,
  { before, limit = ACTIVITY_PAGE_SIZE }: { before?: string; limit?: number } = {},
): Promise<ActivityItem[]> {
  let query = client
    .from('activity')
    .select(
      `id, group_id, actor_id, verb, subject_id, data, created_at,
      actor:profiles!activity_actor_id_fkey (id, display_name, avatar_path),
      group:groups (id, name, emoji, is_direct)`,
    )
    .order('created_at', { ascending: false })
    .limit(limit)
  if (before) query = query.lt('created_at', before)
  return unwrap(await query) as unknown as ActivityItem[]
}

export async function fetchReceiptUrl(client: PotluckClient, path: string): Promise<string> {
  const data = unwrap(await client.storage.from('receipts').createSignedUrl(path, 60 * 60))
  if (!data?.signedUrl) throw new Error('receipt_unavailable')
  return data.signedUrl
}

// Writes --------------------------------------------------------------------------------------

export async function createExpense(
  client: PotluckClient,
  payload: ExpensePayload,
): Promise<Expense> {
  return unwrap(await client.rpc('create_expense', { payload: payload as unknown as Json }))
}

export async function updateExpense(
  client: PotluckClient,
  expenseId: string,
  payload: Omit<ExpensePayload, 'group_id' | 'recurrence'>,
): Promise<Expense> {
  return unwrap(
    await client.rpc('update_expense', { id: expenseId, payload: payload as unknown as Json }),
  )
}

export async function deleteExpense(client: PotluckClient, expenseId: string): Promise<Expense> {
  return unwrap(await client.rpc('delete_expense', { id: expenseId }))
}

export async function restoreExpense(client: PotluckClient, expenseId: string): Promise<Expense> {
  return unwrap(await client.rpc('restore_expense', { id: expenseId }))
}

export async function addExpenseComment(
  client: PotluckClient,
  input: { expenseId: string; groupId: string; authorId: string; body: string },
): Promise<ExpenseComment> {
  return unwrap(
    await client
      .from('comments')
      .insert({
        expense_id: input.expenseId,
        group_id: input.groupId,
        author_id: input.authorId,
        body: input.body,
      })
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

export async function settleUp(client: PotluckClient, input: SettleUpInput): Promise<Settlement> {
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
  viewer: (client: PotluckClient) =>
    queryOptions({ queryKey: moneyKeys.viewer(), queryFn: () => fetchViewer(client) }),
  people: (client: PotluckClient) =>
    queryOptions({ queryKey: moneyKeys.people(), queryFn: () => fetchPeople(client) }),
  myGroups: (client: PotluckClient) =>
    queryOptions({ queryKey: moneyKeys.myGroups(), queryFn: () => fetchMyGroups(client) }),
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
  expense: (client: PotluckClient, expenseId: string) =>
    queryOptions({
      queryKey: moneyKeys.expense(expenseId),
      queryFn: () => fetchExpense(client, expenseId),
    }),
  comments: (client: PotluckClient, expenseId: string) =>
    queryOptions({
      queryKey: moneyKeys.comments(expenseId),
      queryFn: () => fetchExpenseComments(client, expenseId),
    }),
  fxRate: (client: PotluckClient, from: string, to: string) =>
    queryOptions({
      queryKey: moneyKeys.fxRate(from, to),
      queryFn: () => fetchLatestFxRate(client, from, to),
      staleTime: 60 * 60 * 1000,
    }),
  fxCurrencies: (client: PotluckClient, to: string) =>
    queryOptions({
      queryKey: moneyKeys.fxCurrencies(to),
      queryFn: () => fetchFxCurrencies(client, to),
      staleTime: 60 * 60 * 1000,
    }),
  receiptUrl: (client: PotluckClient, path: string) =>
    queryOptions({
      queryKey: moneyKeys.receiptUrl(path),
      queryFn: () => fetchReceiptUrl(client, path),
      staleTime: 50 * 60 * 1000,
    }),
}
