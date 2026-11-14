import {
  appConfigQueryOptions,
  avatarUrl,
  coverUrl,
  isFlagOn,
  myProfileQueryOptions,
  type ProfileRow,
} from '@potluck/api'
import { useQuery } from '@tanstack/react-query'
import { useUserId } from './auth'
import { resolveTimeZone } from './locale'
import { supabase } from './supabase'

/** The signed-in person's profile. Only under the authenticated layout. */
export function useMyProfile() {
  const userId = useUserId()
  return useQuery(myProfileQueryOptions(supabase, userId))
}

/** Timezone to render times in: the profile's, or the device's while it loads. */
export function useViewerTimezone(): string {
  const { data } = useMyProfile()
  return resolveTimeZone(data?.timezone)
}

export function useAppConfig() {
  return useQuery(appConfigQueryOptions(supabase))
}

export function useFlag(key: string): boolean {
  const { data } = useAppConfig()
  return isFlagOn(data, key)
}

export function profileAvatar(profile: Pick<ProfileRow, 'avatar_path'> | null | undefined) {
  return avatarUrl(supabase, profile?.avatar_path)
}

export function avatarSrc(path: string | null | undefined): string | null {
  return avatarUrl(supabase, path)
}

/** Public URL of a group cover, or null. Works signed out (the join page). */
export function coverSrc(path: string | null | undefined): string | null {
  return coverUrl(supabase, path)
}
