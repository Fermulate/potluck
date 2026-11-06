import { plansKeys, setAvailability, type PlanAvailabilityRow } from '@potluck/api'
import { t } from '@potluck/i18n'
import { toast } from '@potluck/ui'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBatchedInvalidate, useRealtime } from '@/lib/realtime'
import { supabase } from '@/lib/supabase'
import { slotKey, type PaintLevel } from '@/features/availability/grid'
import { planErrorCode, planErrorMessage } from './format'

/**
 * Live updates for one event: availability (the heatmap), the event row (locked, cancelled),
 * RSVPs, and new comments (via the group's activity feed, since comments are not published
 * themselves). Invalidations are batched so a burst of rows refetches once.
 */
export function useEventRealtime(eventId: string, groupId: string | undefined) {
  const bump = useBatchedInvalidate()
  useRealtime(
    groupId ? `plan:${eventId}` : null,
    [
      { table: 'availability', filter: `event_id=eq.${eventId}` },
      { table: 'events', filter: `id=eq.${eventId}` },
      { table: 'event_rsvps', filter: `event_id=eq.${eventId}` },
      { table: 'activity', event: 'INSERT', filter: `group_id=eq.${groupId}` },
    ],
    (payload) => {
      switch (payload.table) {
        case 'availability':
          bump(
            plansKeys.availability(eventId),
            plansKeys.bestSlots(eventId),
            plansKeys.requests(eventId),
          )
          break
        case 'events':
          if (groupId) {
            bump(plansKeys.event(eventId), plansKeys.timelineAll(), plansKeys.groupEvents(groupId))
          }
          break
        case 'event_rsvps':
          bump(plansKeys.rsvps(eventId))
          break
        case 'activity': {
          const row = payload.new as { verb?: string; data?: { event_id?: string } }
          if (row.verb === 'comment.created' && row.data?.event_id === eventId) {
            bump(plansKeys.comments(eventId))
          }
          if (row.verb === 'availability.requested') bump(plansKeys.requests(eventId))
        }
      }
    },
  )
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'failed' | 'rejected'

function writeCache(
  queryClient: QueryClient,
  eventId: string,
  userId: string,
  value: ReadonlyMap<string, PaintLevel>,
) {
  queryClient.setQueryData<PlanAvailabilityRow[]>(plansKeys.availability(eventId), (rows) => [
    ...(rows ?? []).filter((r) => r.user_id !== userId),
    ...[...value].map(([slot, level]) => ({
      event_id: eventId,
      user_id: userId,
      slot_start: slot,
      level,
    })),
  ])
}

/** The viewer's painted slots from the server rows. */
export function mySlots(rows: readonly PlanAvailabilityRow[], userId: string) {
  const map = new Map<string, PaintLevel>()
  for (const r of rows) if (r.user_id === userId) map.set(slotKey(r.slot_start), r.level)
  return map
}

const RETRIES = 3
const RETRY_DELAY = 1_000

/**
 * Local, optimistic copy of the viewer's availability. Until the first paint it mirrors the
 * server rows; every change then shows immediately (the heatmap reads the same cache) and is
 * saved after a short pause. Saves run one at a time so the server always ends on the latest
 * map; a save that fails for a passing reason is retried with backoff, then marked failed,
 * while one the server rejects outright (poll closed, not a member, bad slots) is dropped and
 * the server state refetched. A pending save is flushed when the owner unmounts or the tab is
 * hidden, so mount this where it outlives the painter.
 */
export function useMyAvailability(
  eventId: string,
  userId: string,
  initial: Map<string, PaintLevel>,
) {
  const queryClient = useQueryClient()
  const [edits, setEdits] = useState<Map<string, PaintLevel> | null>(null)
  const value = edits ?? initial
  const [state, setState] = useState<SaveState>('idle')
  const [rejection, setRejection] = useState<string | null>(null)
  const pending = useRef<Map<string, PaintLevel> | null>(null)
  const inFlight = useRef<Promise<boolean> | null>(null)
  const attempts = useRef(0)
  const timer = useRef<number | undefined>(undefined)

  const saveRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const save = useCallback(async () => {
    window.clearTimeout(timer.current)
    timer.current = undefined
    if (inFlight.current) return
    const next = pending.current
    if (!next) return
    pending.current = null
    setState('saving')
    inFlight.current = (async () => {
      try {
        await setAvailability(
          supabase,
          eventId,
          [...next].map(([slot_start, level]) => ({ slot_start, level })),
        )
        attempts.current = 0
        if (!pending.current) {
          writeCache(queryClient, eventId, userId, next)
          setState('saved')
        }
        void queryClient.invalidateQueries({ queryKey: plansKeys.bestSlots(eventId) })
        void queryClient.invalidateQueries({ queryKey: plansKeys.requests(eventId) })
        void queryClient.invalidateQueries({ queryKey: plansKeys.timelineAll() })
        return true
      } catch (error) {
        if (planErrorCode(error)) {
          window.clearTimeout(timer.current)
          timer.current = undefined
          pending.current = null
          setEdits(null)
          setRejection(planErrorMessage(error))
          setState('rejected')
          toast.error(planErrorMessage(error), { id: `availability-${eventId}` })
          void queryClient.invalidateQueries({ queryKey: plansKeys.event(eventId) })
          void queryClient.invalidateQueries({ queryKey: plansKeys.availability(eventId) })
          return false
        }
        // Keep the failed copy unless something newer is already waiting.
        if (!pending.current) pending.current = next
        const willRetry = timer.current !== undefined || attempts.current < RETRIES
        setState(willRetry ? 'error' : 'failed')
        toast.error(planErrorMessage(error), {
          id: `availability-${eventId}`,
          action: { label: t('common.retry'), onClick: () => void saveRef.current() },
        })
        if (timer.current === undefined && attempts.current < RETRIES) {
          attempts.current += 1
          timer.current = window.setTimeout(
            () => void saveRef.current(),
            RETRY_DELAY * 2 ** (attempts.current - 1),
          )
        }
        return false
      } finally {
        inFlight.current = null
      }
    })()
    const saved = await inFlight.current
    if (saved && pending.current && !timer.current) await saveRef.current()
  }, [eventId, userId, queryClient])

  useEffect(() => {
    saveRef.current = save
  }, [save])

  const change = useCallback(
    (next: Map<string, PaintLevel>) => {
      setEdits(next)
      writeCache(queryClient, eventId, userId, next)
      pending.current = next
      attempts.current = 0
      setRejection(null)
      setState('saving')
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void save(), 700)
    },
    [eventId, userId, queryClient, save],
  )

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void save()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      void save()
    }
  }, [save])

  return { value, change, state, rejection, retry: save }
}
