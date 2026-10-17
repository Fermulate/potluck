import {
  appConfigQueryOptions,
  avatarUrl,
  isFlagOn,
  myProfileQueryOptions,
  type ProfileRow,
} from '@potluck/api'
import { useQuery } from '@tanstack/react-query'
import { useUserId } from './auth'
import { detectTimezone } from './locale'
import { supabase } from './supabase'

/** The signed-in person's profile. Only under the authenticated layout. */
export function useMyProfile() {
  const userId = useUserId()
  return useQuery(myProfileQueryOptions(supabase, userId))
}

/** Timezone to render times in: the profile's, or the device's while it loads. */
export function useViewerTimezone(): string {
  const { data } = useMyProfile()
  return data?.timezone ?? detectTimezone()
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
