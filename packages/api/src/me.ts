/**
 * me queries and mutations: profile, notifications, push, app config, account.
 * Platform-neutral: no DOM imports.
 */
import { queryOptions } from '@tanstack/react-query'
import type { Database, Json } from './database.types'
import type { PotluckClient } from './index'

type Tables = Database['public']['Tables']
export type ProfileRow = Tables['profiles']['Row']
export type NotificationRow = Tables['notifications']['Row']
export type PushPlatform = Database['public']['Enums']['push_platform']

export const meKeys = {
  all: ['potluck', 'me'] as const,
  profile: (userId: string) => ['potluck', 'me', 'profile', userId] as const,
  notifications: (userId: string) => ['potluck', 'me', 'notifications', userId] as const,
  unread: (userId: string) => ['potluck', 'me', 'notifications', userId, 'unread'] as const,
  pushTokens: (userId: string) => ['potluck', 'me', 'push-tokens', userId] as const,
  appConfig: ['potluck', 'app-config'] as const,
}

// Profile ----------------------------------------------------------------------

export async function fetchMyProfile(client: PotluckClient, userId: string) {
  const { data, error } = await client.from('profiles').select('*').eq('id', userId).single()
  if (error) throw error
  return data
}

export const myProfileQueryOptions = (client: PotluckClient, userId: string) =>
  queryOptions({
    queryKey: meKeys.profile(userId),
    queryFn: () => fetchMyProfile(client, userId),
    staleTime: 5 * 60_000,
  })

export type ProfilePatch = Partial<
  Pick<ProfileRow, 'display_name' | 'avatar_path' | 'timezone' | 'default_currency' | 'locale'>
>

export async function updateMyProfile(client: PotluckClient, userId: string, patch: ProfilePatch) {
  const { data, error } = await client
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select()
    .single()
  if (error) throw error
  return data
}

export const AVATAR_BUCKET = 'avatars'

/** Public URL for a stored avatar path (`<user_id>/<file>`), or null. */
export function avatarUrl(client: PotluckClient, path: string | null | undefined): string | null {
  if (!path) return null
  return client.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl
}

/**
 * Uploads an avatar under `<user_id>/` and returns its storage path. The file name changes on
 * every upload so caches never serve the old face.
 */
export async function uploadAvatar(
  client: PotluckClient,
  userId: string,
  body: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<string> {
  const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'img'
  const path = `${userId}/${Date.now().toString(36)}.${ext}`
  const { error } = await client.storage
    .from(AVATAR_BUCKET)
    .upload(path, body, { contentType, upsert: false, cacheControl: '31536000' })
  if (error) throw error
  return path
}

export async function removeAvatarFile(client: PotluckClient, path: string) {
  const { error } = await client.storage.from(AVATAR_BUCKET).remove([path])
  if (error) throw error
}

// Notifications ----------------------------------------------------------------

export const NOTIFICATIONS_PAGE = 50

export async function fetchNotifications(client: PotluckClient, userId: string) {
  const { data, error } = await client
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(NOTIFICATIONS_PAGE)
  if (error) throw error
  return data ?? []
}

export const notificationsQueryOptions = (client: PotluckClient, userId: string) =>
  queryOptions({
    queryKey: meKeys.notifications(userId),
    queryFn: () => fetchNotifications(client, userId),
  })

export async function fetchUnreadCount(client: PotluckClient, userId: string): Promise<number> {
  const { count, error } = await client
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)
  if (error) throw error
  return count ?? 0
}

export const unreadCountQueryOptions = (client: PotluckClient, userId: string) =>
  queryOptions({
    queryKey: meKeys.unread(userId),
    queryFn: () => fetchUnreadCount(client, userId),
  })

export async function markNotificationsRead(client: PotluckClient, ids: string[]) {
  if (ids.length === 0) return
  const { error } = await client
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids)
    .is('read_at', null)
  if (error) throw error
}

export async function markAllNotificationsRead(client: PotluckClient, userId: string) {
  const { error } = await client
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null)
  if (error) throw error
}

// Push -------------------------------------------------------------------------

export async function fetchPushTokens(client: PotluckClient, userId: string) {
  const { data, error } = await client
    .from('push_tokens')
    .select('token, platform, last_seen_at')
    .eq('user_id', userId)
  if (error) throw error
  return data ?? []
}

export const pushTokensQueryOptions = (client: PotluckClient, userId: string) =>
  queryOptions({
    queryKey: meKeys.pushTokens(userId),
    queryFn: () => fetchPushTokens(client, userId),
  })

/** Stores (or refreshes) a push registration. For web push `token` is the endpoint URL. */
export async function savePushToken(
  client: PotluckClient,
  userId: string,
  input: { token: string; platform: PushPlatform; subscription?: Json },
) {
  const { error } = await client.from('push_tokens').upsert(
    {
      user_id: userId,
      token: input.token,
      platform: input.platform,
      subscription: input.subscription ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,token' },
  )
  if (error) throw error
}

export async function deletePushToken(client: PotluckClient, userId: string, token: string) {
  const { error } = await client
    .from('push_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('token', token)
  if (error) throw error
}

// App config -------------------------------------------------------------------

export type AppConfig = Record<string, Json>

/** Feature flags and client versions. Readable signed out. */
export async function fetchAppConfig(client: PotluckClient): Promise<AppConfig> {
  const { data, error } = await client.from('app_config').select('key, value')
  if (error) throw error
  return Object.fromEntries((data ?? []).map((row) => [row.key, row.value]))
}

export const appConfigQueryOptions = (client: PotluckClient) =>
  queryOptions({
    queryKey: meKeys.appConfig,
    queryFn: () => fetchAppConfig(client),
    staleTime: 10 * 60_000,
  })

/** A boolean feature flag. Anything but literal `true` is off. */
export function isFlagOn(config: AppConfig | undefined, key: string): boolean {
  return config?.[key] === true
}

// Account ----------------------------------------------------------------------

/** Tombstones the profile and closes the account. Sign out afterwards. */
export async function deleteMyAccount(client: PotluckClient) {
  const { error } = await client.rpc('delete_my_account')
  if (error) throw error
}
