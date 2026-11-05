import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

type PostgresEvent = '*' | 'INSERT' | 'UPDATE' | 'DELETE'

export interface RealtimeSubscription {
  table: string
  event?: PostgresEvent
  /** PostgREST style filter, e.g. `user_id=eq.<id>`. */
  filter?: string
}

/**
 * Subscribes to Postgres changes while mounted and calls `onChange` for each one. Pass a stable
 * `channel` name; changing it resubscribes. Disabled when `channel` is null.
 */
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
    let ch = supabase.channel(channel)
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
