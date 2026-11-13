/**
 * Notification settings: which categories push and email, and the email unsubscribe link.
 * Defaults live in the database (`private.notification_categories`); the client only shows them.
 * Platform-neutral: no DOM imports.
 */
import { queryOptions } from '@tanstack/react-query'
import type { PotluckClient } from './index'

/** The settings this client knows how to label, in display order. */
export const NOTIFICATION_CATEGORIES = [
  'expense_added',
  'expense_changed',
  'payments',
  'comments',
  'groups',
  'plans',
  'reminders',
  'monthly_summary',
] as const

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

export interface NotificationPref {
  category: NotificationCategory
  push: boolean
  email: boolean
  /** Whether it reaches the inbox. Always true unless `inbox_allowed` (the monthly summary). */
  inbox: boolean
  push_allowed: boolean
  email_allowed: boolean
  /** This setting has its own inbox switch. */
  inbox_allowed: boolean
}

export const isNotificationCategory = (value: string): value is NotificationCategory =>
  (NOTIFICATION_CATEGORIES as readonly string[]).includes(value)

export const notificationPrefKeys = {
  mine: (userId: string) => ['potluck', 'me', 'notification-prefs', userId] as const,
  unsubscribe: (token: string) => ['potluck', 'unsubscribe', token] as const,
}

/** Every setting with its effective value. Categories this client cannot label are left out. */
export async function fetchNotificationPrefs(client: PotluckClient): Promise<NotificationPref[]> {
  const { data, error } = await client.rpc('my_notification_prefs')
  if (error) throw error
  return (data ?? []).filter((row): row is NotificationPref => isNotificationCategory(row.category))
}

export const notificationPrefsQueryOptions = (client: PotluckClient, userId: string) =>
  queryOptions({
    queryKey: notificationPrefKeys.mine(userId),
    queryFn: () => fetchNotificationPrefs(client),
    staleTime: 5 * 60_000,
  })

/** Changes one channel (or both) of one setting; the other stays as it is. */
export async function setNotificationPref(
  client: PotluckClient,
  category: NotificationCategory,
  change: { push?: boolean; email?: boolean; inbox?: boolean },
) {
  const { error } = await client.rpc('set_notification_pref', { category, ...change })
  if (error) throw error
}

export type UnsubscribeAction = 'preview' | 'unsubscribe' | 'undo'

export interface UnsubscribeResult {
  /** The setting the link covers, `all` for every email, null for one this client cannot label. */
  category: NotificationCategory | 'all' | null
  /** The account's address, masked ("a***@example.com"). */
  email: string | null
  /** Whether any email the link covers is still on, after the action. */
  subscribed: boolean
  /** For `undo`: whether anything changed (an `all` link with nothing saved changes nothing). */
  restored: boolean
}

/**
 * An email's unsubscribe link, signed in or not. `preview` changes nothing, `unsubscribe` turns
 * that email off, `undo` puts back exactly what the unsubscribe changed.
 */
export async function emailUnsubscribe(
  client: PotluckClient,
  token: string,
  action: UnsubscribeAction,
): Promise<UnsubscribeResult> {
  const { data, error } = await client.rpc('email_unsubscribe', { token, action })
  if (error) throw error
  const row = (data ?? {}) as {
    category?: unknown
    email?: unknown
    subscribed?: unknown
    restored?: unknown
  }
  const category = typeof row.category === 'string' ? row.category : ''
  return {
    category: category === 'all' || isNotificationCategory(category) ? category : null,
    email: typeof row.email === 'string' ? row.email : null,
    subscribed: row.subscribed === true,
    restored: row.restored === true,
  }
}

/** What an unsubscribe link covers, without changing anything. */
export const unsubscribePreviewQueryOptions = (client: PotluckClient, token: string) =>
  queryOptions({
    queryKey: notificationPrefKeys.unsubscribe(token),
    queryFn: () => emailUnsubscribe(client, token, 'preview'),
    retry: false,
    staleTime: Infinity,
  })
