import { planQueries, type PlanProfile } from '@potluck/api'
import { useQuery } from '@tanstack/react-query'
import { useUserId } from '@/lib/auth'
import { resolveTimeZone } from '@/lib/locale'
import { supabase } from '@/lib/supabase'

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
  return { userId, timeZone: resolveTimeZone(data?.timezone), profile: data }
}
