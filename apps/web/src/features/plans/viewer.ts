import { planQueries, type PlanProfile } from '@potluck/api'
import { useQuery } from '@tanstack/react-query'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

/** The browser's zone, or UTC when Intl cannot tell. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** The zone to render times in: the profile's zone, or the browser's until the profile loads. */
export function resolveTimeZone(profile: Pick<PlanProfile, 'timezone'> | undefined): string {
  return profile?.timezone || browserTimeZone()
}

export function useViewerProfile() {
  const userId = useUserId()
  return useQuery(planQueries.profile(supabase, userId))
}

export interface Viewer {
  userId: string
  timeZone: string
  profile: PlanProfile | undefined
}

export function useViewer(): Viewer {
  const userId = useUserId()
  const { data } = useQuery(planQueries.profile(supabase, userId))
  return { userId, timeZone: resolveTimeZone(data), profile: data }
}
