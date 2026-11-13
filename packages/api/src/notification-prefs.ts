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
  push_allowed: boolean
  email_allowed: boolean
}

export const isNotificationCategory = (value: string): value is NotificationCategory =>
  (NOTIFICATION_CATEGORIES as readonly string[]).includes(value)

export const notificationPrefKeys = {
  mine: (userId: string) => ['potluck', 'me', 'notification-prefs', userId] as const,
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
  change: { push?: boolean; email?: boolean },
) {
  const { error } = await client.rpc('set_notification_pref', { category, ...change })
  if (error) throw error
}

/**
 * Applies an unsubscribe link from an email, signed in or not. Returns the category it covered
 * (`all` for every email). `subscribe: true` undoes it.
 */
export async function emailUnsubscribe(
  client: PotluckClient,
  token: string,
  subscribe = false,
): Promise<NotificationCategory | 'all' | null> {
  const { data, error } = await client.rpc('email_unsubscribe', { token, subscribe })
  if (error) throw error
  return data === 'all' || isNotificationCategory(data) ? data : null
}
