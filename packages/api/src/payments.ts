/**
 * Payments beyond the basics in money.ts: recording in either direction or on a past day,
 * editing, restoring, comments, settling several debts at once, reminders and payment methods.
 * Platform-neutral: no DOM imports.
 */
import type { FriendBalanceRow, PaymentKind } from '@potluck/core'
import { queryOptions } from '@tanstack/react-query'
import type { Database } from './database.types'
import type { PotluckClient } from './index'
import { moneyKeys, type ExpenseComment, type Settlement, type SettlementRow } from './money'

type Tables = Database['public']['Tables']

export type DebtReminder = Tables['debt_reminders']['Row']

export interface SavedPaymentMethod {
  user_id: string
  kind: PaymentKind
  handle: string
  updated_at: string
}

/** A comment on a payment. Shares its shape with expense comments. */
export interface PaymentComment extends Omit<ExpenseComment, 'expense_id'> {
  settlement_id: string | null
}

export interface RecordPaymentInput {
  groupId: string
  fromUser: string
  toUser: string
  amountCents: number
  /** Defaults to the group currency. */
  currency?: string
  note?: string | null
  /** `YYYY-MM-DD`. Leave out for today (the payment keeps the current time). */
  settledOn?: string | null
}

/** `update_settlement` takes only the keys that change. `note: null` clears the note. */
export interface PaymentUpdate {
  fromUser?: string
  toUser?: string
  amountCents?: number
  currency?: string
  note?: string | null
  settledOn?: string
}

export interface BulkSettleOptions {
  settledOn?: string | null
  note?: string | null
}

export const paymentKeys = {
  all: ['potluck', 'payments'] as const,
  /** Lives under the money keys so `invalidateMoney` style prefix invalidation reaches it. */
  settlement: (id: string) => [...moneyKeys.all, 'settlement', id] as const,
  comments: (id: string) => [...moneyKeys.all, 'settlement', id, 'comments'] as const,
  /** Under the groups prefix: anything that refreshes the friends list refreshes these. */
  friendBalances: () => ['potluck', 'groups', 'friend-balances'] as const,
  methods: (userId: string) => [...paymentKeys.all, 'methods', userId] as const,
  reminders: () => [...paymentKeys.all, 'reminders'] as const,
}

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

const SETTLEMENT_SELECT =
  'id, group_id, from_user, to_user, amount_cents, currency, fx_rate::text, note, settled_at, created_by, created_at, deleted_at'
const COMMENT_SELECT = 'id, settlement_id, author_id, body, created_at'

// Reads -------------------------------------------------------------------------------------------

/** One payment, including a deleted one (so it can be restored). */
export async function fetchSettlement(client: PotluckClient, id: string): Promise<Settlement> {
  return unwrap(await client.from('settlements').select(SETTLEMENT_SELECT).eq('id', id).single())
}

export async function fetchPaymentComments(
  client: PotluckClient,
  settlementId: string,
): Promise<PaymentComment[]> {
  return unwrap(
    await client
      .from('comments')
      .select(COMMENT_SELECT)
      .eq('settlement_id', settlementId)
      .is('deleted_at', null)
      .order('created_at'),
  )
}

/** What the viewer and each person they share a group with owe each other, per group. */
export async function fetchFriendBalances(client: PotluckClient): Promise<FriendBalanceRow[]> {
  const rows = unwrap(await client.rpc('friend_balances'))
  return (rows ?? []).map((r) => ({
    friendId: r.friend_id,
    groupId: r.group_id,
    currency: r.currency,
    netCents: r.net_cents,
    archived: r.archived,
  }))
}

/** Someone's payment methods: yours, or a group mate's (RLS hides everyone else's). */
export async function fetchPaymentMethods(
  client: PotluckClient,
  userId: string,
): Promise<SavedPaymentMethod[]> {
  const rows = unwrap(
    await client
      .from('payment_methods')
      .select('user_id, kind, handle, updated_at')
      .eq('user_id', userId)
      .order('kind'),
  )
  return rows.map((r) => ({ ...r, kind: r.kind as PaymentKind }))
}

/** Reminders the viewer sent on `day` (`YYYY-MM-DD`, UTC), in any group: one a day per pair. */
export async function fetchRemindersSent(
  client: PotluckClient,
  viewerId: string,
  day: string,
): Promise<DebtReminder[]> {
  return unwrap(
    await client
      .from('debt_reminders')
      .select('id, group_id, from_user, to_user, amount_cents, currency, note, sent_on, created_at')
      .eq('from_user', viewerId)
      .eq('sent_on', day),
  )
}

// Writes ------------------------------------------------------------------------------------------

export async function recordPayment(
  client: PotluckClient,
  input: RecordPaymentInput,
): Promise<SettlementRow> {
  return unwrap(
    await client.rpc('settle_up_v2', {
      group_id: input.groupId,
      from_user: input.fromUser,
      to_user: input.toUser,
      amount_cents: input.amountCents,
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.note ? { note: input.note } : {}),
      ...(input.settledOn ? { settled_on: input.settledOn } : {}),
    }),
  )
}

export async function updateSettlement(
  client: PotluckClient,
  id: string,
  patch: PaymentUpdate,
): Promise<SettlementRow> {
  const payload: Record<string, unknown> = {}
  if (patch.fromUser !== undefined) payload.from_user = patch.fromUser
  if (patch.toUser !== undefined) payload.to_user = patch.toUser
  if (patch.amountCents !== undefined) payload.amount_cents = patch.amountCents
  if (patch.currency !== undefined) payload.currency = patch.currency
  if (patch.note !== undefined) payload.note = patch.note
  if (patch.settledOn !== undefined) payload.settled_on = patch.settledOn
  return unwrap(
    await client.rpc('update_settlement', {
      id,
      payload: payload as Database['public']['Functions']['update_settlement']['Args']['payload'],
    }),
  )
}

export async function restoreSettlement(client: PotluckClient, id: string): Promise<SettlementRow> {
  return unwrap(await client.rpc('restore_settlement', { id }))
}

/** Records every debt the viewer is in, in one group. Returns the payments made. */
export async function settleAll(
  client: PotluckClient,
  groupId: string,
  options: BulkSettleOptions = {},
): Promise<SettlementRow[]> {
  return unwrap(
    await client.rpc('settle_all', {
      group_id: groupId,
      ...(options.settledOn ? { settled_on: options.settledOn } : {}),
      ...(options.note ? { note: options.note } : {}),
    }),
  )
}

/** One payment per shared open group, so everything between the two is square. */
export async function settleWithFriend(
  client: PotluckClient,
  friendId: string,
  options: BulkSettleOptions & {
    /** Only these groups, each with this amount (minor units). Leave out to settle everything. */
    amounts?: Record<string, number>
  } = {},
): Promise<SettlementRow[]> {
  return unwrap(
    await client.rpc('settle_with_friend', {
      friend_id: friendId,
      ...(options.settledOn ? { settled_on: options.settledOn } : {}),
      ...(options.note ? { note: options.note } : {}),
      ...(options.amounts ? { amounts: options.amounts } : {}),
    }),
  )
}

export async function remindDebt(
  client: PotluckClient,
  groupId: string,
  userId: string,
  note?: string | null,
): Promise<DebtReminder> {
  return unwrap(
    await client.rpc('remind_debt', {
      group_id: groupId,
      user_id: userId,
      ...(note?.trim() ? { note: note.trim() } : {}),
    }),
  )
}

/**
 * Clients send `settlement_id` and `body` only: the author defaults to the caller and a trigger
 * copies `group_id` from the payment.
 */
export async function addPaymentComment(
  client: PotluckClient,
  input: { settlementId: string; body: string },
): Promise<PaymentComment> {
  const row = { settlement_id: input.settlementId, body: input.body }
  return unwrap(
    await client
      .from('comments')
      .insert(row as Tables['comments']['Insert'])
      .select(COMMENT_SELECT)
      .single(),
  )
}

/** Adds or replaces the viewer's handle for one kind. */
export async function savePaymentMethod(
  client: PotluckClient,
  input: { kind: PaymentKind; handle: string },
): Promise<SavedPaymentMethod> {
  // user_id defaults to the caller; clients cannot set it.
  const row: Tables['payment_methods']['Insert'] = { kind: input.kind, handle: input.handle }
  const result = await client
    .from('payment_methods')
    .upsert(row, { onConflict: 'user_id,kind' })
    .select('user_id, kind, handle, updated_at')
    .single()
  if (result.error) throw result.error
  return { ...result.data, kind: result.data.kind as PaymentKind }
}

export async function removePaymentMethod(
  client: PotluckClient,
  userId: string,
  kind: PaymentKind,
): Promise<void> {
  unwrap(await client.from('payment_methods').delete().eq('user_id', userId).eq('kind', kind))
}

// Query options ------------------------------------------------------------------------------------

export const paymentQueries = {
  settlement: (client: PotluckClient, id: string) =>
    queryOptions({
      queryKey: paymentKeys.settlement(id),
      queryFn: () => fetchSettlement(client, id),
    }),
  comments: (client: PotluckClient, id: string) =>
    queryOptions({
      queryKey: paymentKeys.comments(id),
      queryFn: () => fetchPaymentComments(client, id),
    }),
  friendBalances: (client: PotluckClient) =>
    queryOptions({
      queryKey: paymentKeys.friendBalances(),
      queryFn: () => fetchFriendBalances(client),
    }),
  methods: (client: PotluckClient, userId: string) =>
    queryOptions({
      queryKey: paymentKeys.methods(userId),
      queryFn: () => fetchPaymentMethods(client, userId),
      staleTime: 5 * 60 * 1000,
    }),
  reminders: (client: PotluckClient, viewerId: string, day: string) =>
    queryOptions({
      queryKey: [...paymentKeys.reminders(), viewerId, day] as const,
      queryFn: () => fetchRemindersSent(client, viewerId, day),
    }),
}
