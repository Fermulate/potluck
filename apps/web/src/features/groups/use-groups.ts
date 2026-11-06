import { groupDetailQueryOptions, groupKeys, myGroupsQueryOptions } from '@potluck/api'
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useUserId } from '@/lib/auth'
import {
  inFilter,
  useBatchedInvalidate,
  useRealtime,
  type RealtimeSubscription,
} from '@/lib/realtime'
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
 * Subscribes `tables` (all keyed by `group_id`) for the viewer's groups only, so the server does
 * not fan every change in the database out to this socket for RLS to sift. Joining a group is
 * caught by the viewer's own membership row; it refreshes the group list, which resubscribes
 * with the new id. Realtime cannot filter deletes, so when `group_members` is watched its
 * deletes (leaving, removals) come in unfiltered as before. Waits for the group list before
 * subscribing. Each change bumps `keys`.
 */
export function useMyGroupsRealtime(
  channel: string,
  tables: Omit<RealtimeSubscription, 'filter'>[],
  keys: (table: string) => QueryKey[],
) {
  const userId = useUserId()
  const { data: groups } = useMyGroups()
  const invalidate = useBatchedInvalidate()
  const ids = useMemo(() => groups?.map((g) => g.id), [groups])
  const subscriptions = useMemo(() => {
    if (!ids) return []
    const filter = inFilter('group_id', ids)
    const out: RealtimeSubscription[] = ids.length > 0 ? tables.map((t) => ({ ...t, filter })) : []
    if (tables.some((t) => t.table === 'group_members')) {
      out.push({ table: 'group_members', event: 'DELETE' })
    }
    out.push({ table: 'group_members', event: 'INSERT', filter: `user_id=eq.${userId}` })
    return out
  }, [ids, tables, userId])
  useRealtime(ids ? channel : null, subscriptions, (payload) => {
    const row = payload.new as { user_id?: string } | undefined
    const mine =
      payload.table === 'group_members' &&
      (payload.eventType === 'DELETE' || row?.user_id === userId)
    invalidate(...keys(payload.table), ...(mine ? [groupKeys.list(userId)] : []))
  })
}

const GROUP_TABLES = [
  { table: 'group_members' },
  { table: 'expenses' },
  { table: 'settlements' },
] satisfies Omit<RealtimeSubscription, 'filter'>[]
const allGroups = () => [groupKeys.all]

/**
 * Keeps group lists and balances fresh: membership changes and money movements in my groups (or
 * in one group) refetch them.
 */
export function useGroupsRealtime(groupId?: string) {
  const invalidate = useBatchedInvalidate()
  const filter = `group_id=eq.${groupId}`
  useRealtime(
    groupId ? `groups-live-${groupId}` : null,
    GROUP_TABLES.map((t) => ({ ...t, filter })),
    () => invalidate(groupKeys.all),
  )
}

/** Group list variant of `useGroupsRealtime`, scoped to the viewer's groups. */
export function useAllGroupsRealtime() {
  useMyGroupsRealtime('groups-live', GROUP_TABLES, allGroups)
}
