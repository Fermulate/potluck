import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'
import { supabase } from './supabase'

/**
 * Invalidation that coalesces bursts. One expense save sends several change events (the row,
 * its activity, notifications); refetching per event cancels and restarts the same requests.
 * Keys bumped within `delay` ms are invalidated once. Pending keys are flushed on unmount so a
 * quick navigation never leaves stale data behind.
 */
export function useBatchedInvalidate(delay = 300) {
  const queryClient = useQueryClient()
  const pending = useRef(new Map<string, QueryKey>())
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = undefined
    const keys = [...pending.current.values()]
    pending.current.clear()
    for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey })
  }, [queryClient])

  useEffect(() => flush, [flush])

  return useCallback(
    (...keys: QueryKey[]) => {
      for (const key of keys) pending.current.set(JSON.stringify(key), key)
      timer.current ??= setTimeout(flush, delay)
    },
    [flush, delay],
  )
}

type PostgresEvent = '*' | 'INSERT' | 'UPDATE' | 'DELETE'

/** Realtime caps an `in` filter at 100 values. */
const MAX_IN_VALUES = 100

/**
 * `column=in.(a,b)` for a set of ids, or undefined when there are too many for Realtime to take
 * (the subscription then relies on RLS alone).
 */
export function inFilter(column: string, ids: readonly string[]): string | undefined {
  if (ids.length === 0 || ids.length > MAX_IN_VALUES) return undefined
  return `${column}=in.(${[...ids].sort().join(',')})`
}

export interface RealtimeSubscription {
  table: string
  event?: PostgresEvent
  /** PostgREST style filter, e.g. `user_id=eq.<id>`. */
  filter?: string
}

/**
 * Subscribes to Postgres changes while mounted and calls `onChange` for each one. Pass a stable
 * `channel` label; changing it resubscribes. Disabled when `channel` is null. Each mount gets its
 * own topic, so a remount never picks up a channel the previous mount is still leaving.
 */
let mounts = 0

export function useRealtime(
  channel: string | null,
  subscriptions: RealtimeSubscription[],
  onChange: (payload: { table: string; eventType: string; new: unknown; old: unknown }) => void,
) {
  const handler = useRef(onChange)
  useEffect(() => {
    handler.current = onChange
  })
  const key = JSON.stringify(subscriptions)

  useEffect(() => {
    if (!channel) return
    const subs = JSON.parse(key) as RealtimeSubscription[]
    let ch = supabase.channel(`${channel}:${++mounts}`)
    for (const sub of subs) {
      ch = ch.on(
        'postgres_changes' as never,
        {
          event: sub.event ?? '*',
          schema: 'public',
          table: sub.table,
          filter: sub.filter,
        } as never,
        (payload: { table: string; eventType: string; new: unknown; old: unknown }) =>
          handler.current(payload),
      )
    }
    ch.subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [channel, key])
}
