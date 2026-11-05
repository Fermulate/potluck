import { groupDetailQueryOptions, groupKeys, myGroupsQueryOptions } from '@potluck/api'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useUserId } from '@/lib/auth'
import { useBatchedInvalidate, useRealtime } from '@/lib/realtime'
import { supabase } from '@/lib/supabase'

export function useMyGroups() {
  const userId = useUserId()
  return useQuery(myGroupsQueryOptions(supabase, userId))
}

export function useGroup(groupId: string) {
  const userId = useUserId()
  const queryClient = useQueryClient()
  return useQuery({
    ...groupDetailQueryOptions(supabase, groupId, userId),
    // Seed from the list so opening a card paints instantly.
    initialData: () =>
      queryClient
        .getQueryData(myGroupsQueryOptions(supabase, userId).queryKey)
        ?.find((g) => g.id === groupId),
    initialDataUpdatedAt: () =>
      queryClient.getQueryState(myGroupsQueryOptions(supabase, userId).queryKey)?.dataUpdatedAt,
  })
}

/**
 * Keeps group lists and balances fresh: membership changes and money movements in any of my
 * groups refetch them. RLS limits the stream to groups the viewer is in.
 */
export function useGroupsRealtime(groupId?: string) {
  const invalidate = useBatchedInvalidate()
  const filter = groupId ? `group_id=eq.${groupId}` : undefined
  useRealtime(
    `groups-live${groupId ? `-${groupId}` : ''}`,
    [
      { table: 'group_members', filter },
      { table: 'expenses', filter },
      { table: 'settlements', filter },
    ],
    () => invalidate(groupKeys.all),
  )
}
