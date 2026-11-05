import {
  activityInfiniteQueryOptions,
  groupDetailQueryOptions,
  moneyQueries,
  myGroupsQueryOptions,
  myProfileQueryOptions,
  notificationsQueryOptions,
  planQueries,
  unreadCountQueryOptions,
} from '@potluck/api'
import type { QueryClient } from '@tanstack/react-query'
import { timelineRange } from '@/features/plans/use-range'
import { supabase } from './supabase'

/**
 * Route loaders start a screen's queries while its code is still downloading, and on hover or
 * focus of a link (the router preloads on intent). Nothing here is awaited: screens keep their
 * own skeletons, the loader only moves the requests earlier. Every call uses the same query
 * options as the screen, so the screen picks up the same cache entry.
 */
export const prefetch = {
  shell(queryClient: QueryClient, userId: string) {
    void queryClient.prefetchQuery(myProfileQueryOptions(supabase, userId))
    void queryClient.prefetchQuery(unreadCountQueryOptions(supabase, userId))
  },

  home(queryClient: QueryClient, userId: string) {
    void queryClient.prefetchQuery(planQueries.homeBalances(supabase, userId))
    void queryClient.prefetchQuery(planQueries.timeline(supabase, timelineRange()))
    void queryClient.prefetchQuery(planQueries.groups(supabase))
  },

  plans(queryClient: QueryClient) {
    const range = timelineRange()
    void queryClient.prefetchQuery(planQueries.timeline(supabase, range))
    void queryClient.prefetchQuery(planQueries.past(supabase, range.from))
    void queryClient.prefetchQuery(planQueries.groups(supabase))
  },

  groups(queryClient: QueryClient, userId: string) {
    void queryClient.prefetchQuery(myGroupsQueryOptions(supabase, userId))
  },

  group(queryClient: QueryClient, groupId: string, userId: string) {
    void queryClient.prefetchQuery(groupDetailQueryOptions(supabase, groupId, userId))
    void queryClient.prefetchQuery(moneyQueries.group(supabase, groupId))
    void queryClient.prefetchQuery(moneyQueries.people(supabase))
  },

  expenses(queryClient: QueryClient, groupId: string) {
    void queryClient.prefetchQuery(moneyQueries.expenses(supabase, groupId))
    void queryClient.prefetchQuery(moneyQueries.settlements(supabase, groupId))
    void queryClient.prefetchQuery(moneyQueries.recurring(supabase, groupId))
  },

  balances(queryClient: QueryClient, groupId: string) {
    void queryClient.prefetchQuery(moneyQueries.balances(supabase, groupId))
    void queryClient.prefetchQuery(moneyQueries.simplified(supabase, groupId))
    void queryClient.prefetchQuery(moneyQueries.expenses(supabase, groupId))
    void queryClient.prefetchQuery(moneyQueries.settlements(supabase, groupId))
  },

  event(queryClient: QueryClient, eventId: string) {
    // Members need the group id and the panels depend on the status, so they follow the event.
    void queryClient
      .ensureQueryData(planQueries.event(supabase, eventId))
      .then((event) => {
        void queryClient.prefetchQuery(planQueries.members(supabase, event.group_id))
        if (event.status === 'polling') {
          void queryClient.prefetchQuery(planQueries.availability(supabase, eventId))
          void queryClient.prefetchQuery(planQueries.bestSlots(supabase, eventId))
          void queryClient.prefetchQuery(planQueries.requests(supabase, eventId))
        } else {
          void queryClient.prefetchQuery(planQueries.rsvps(supabase, eventId))
        }
      })
      .catch(() => undefined)
    void queryClient.prefetchQuery(planQueries.comments(supabase, eventId))
  },

  activity(queryClient: QueryClient) {
    void queryClient.prefetchInfiniteQuery(activityInfiniteQueryOptions(supabase))
    void queryClient.prefetchQuery(moneyQueries.people(supabase))
  },

  notifications(queryClient: QueryClient, userId: string) {
    void queryClient.prefetchQuery(notificationsQueryOptions(supabase, userId))
  },
}
