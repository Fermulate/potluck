import {
  groupKeys,
  markAllNotificationsRead,
  markNotificationsRead,
  meKeys,
  notificationsQueryOptions,
  unreadCountQueryOptions,
  type NotificationRow,
} from '@potluck/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useUserId } from '@/lib/auth'
import { useRealtime } from '@/lib/realtime'
import { supabase } from '@/lib/supabase'

export function useUnreadCount() {
  const userId = useUserId()
  return useQuery(unreadCountQueryOptions(supabase, userId))
}

export function useNotifications() {
  const userId = useUserId()
  return useQuery(notificationsQueryOptions(supabase, userId))
}

const GROUP_CHANGES = new Set(['group.deleted', 'group.restored'])

/** New notifications arrive over Realtime; mount once in the app layout. */
export function useNotificationsRealtime() {
  const userId = useUserId()
  const queryClient = useQueryClient()
  useRealtime(
    `notifications-${userId}`,
    [{ table: 'notifications', filter: `user_id=eq.${userId}` }],
    (payload) => {
      void queryClient.invalidateQueries({ queryKey: meKeys.notifications(userId) })
      const type = (payload.new as { type?: unknown } | null)?.type
      if (typeof type === 'string' && GROUP_CHANGES.has(type)) {
        void queryClient.invalidateQueries({ queryKey: groupKeys.all })
      }
    },
  )
}

/** Marks notifications read with an optimistic update of the list and the badge. */
export function useMarkRead() {
  const userId = useUserId()
  const queryClient = useQueryClient()
  const listKey = meKeys.notifications(userId)
  const unreadKey = meKeys.unread(userId)

  return useMutation({
    mutationFn: (ids: string[] | 'all') =>
      ids === 'all'
        ? markAllNotificationsRead(supabase, userId)
        : markNotificationsRead(supabase, ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: listKey })
      const previous = queryClient.getQueryData<NotificationRow[]>(listKey)
      const previousUnread = queryClient.getQueryData<number>(unreadKey)
      const now = new Date().toISOString()
      let changed = 0
      queryClient.setQueryData<NotificationRow[]>(listKey, (rows) =>
        rows?.map((row) => {
          if (row.read_at || (ids !== 'all' && !ids.includes(row.id))) return row
          changed++
          return { ...row, read_at: now }
        }),
      )
      queryClient.setQueryData<number>(unreadKey, (n) =>
        ids === 'all' ? 0 : Math.max(0, (n ?? 0) - changed),
      )
      return { previous, previousUnread }
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(listKey, context.previous)
      if (context?.previousUnread !== undefined)
        queryClient.setQueryData(unreadKey, context.previousUnread)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: listKey })
    },
  })
}
