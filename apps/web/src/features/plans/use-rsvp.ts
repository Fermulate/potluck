import { plansKeys, setRsvp, type PlanRsvp, type RsvpStatus } from '@potluck/api'
import { t } from '@potluck/i18n'
import { toast } from '@potluck/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { planErrorMessage } from './format'

/** Optimistic RSVP write shared by the event page and the home "needs you" cards. */
export function useRsvp(eventId: string, userId: string) {
  const queryClient = useQueryClient()
  const key = plansKeys.rsvps(eventId)
  return useMutation({
    mutationFn: (status: RsvpStatus) => setRsvp(supabase, eventId, userId, status),
    onMutate: async (status) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<PlanRsvp[]>(key)
      queryClient.setQueryData<PlanRsvp[]>(key, (rows) => [
        ...(rows ?? []).filter((r) => r.user_id !== userId),
        { event_id: eventId, user_id: userId, status, updated_at: new Date().toISOString() },
      ])
      return { previous }
    },
    onError: (error, _status, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
      toast.error(t('rsvp.failed'), { description: planErrorMessage(error) })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: plansKeys.timelineAll() })
    },
  })
}
