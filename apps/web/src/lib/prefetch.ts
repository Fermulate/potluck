import {
  activityInfiniteQueryOptions,
  groupDetailQueryOptions,
  moneyQueries,
  myGroupsQueryOptions,
  myProfileQueryOptions,
  notificationsQueryOptions,
  planQueries,
  unreadCountQueryOptions,
  type PotluckClient,
} from '@potluck/api'
import type { QueryClient } from '@tanstack/react-query'
import { timelineRange } from '@/features/plans/use-range'
import { loadSupabase } from './auth'

/** Runs once the client is there (it is already loading for anyone who is signed in). */
function withClient(fn: (client: PotluckClient) => void) {
  void loadSupabase().then(fn)
}

/**
 * Route loaders start a screen's queries while its code is still downloading, and on hover or
 * focus of a link (the router preloads on intent). Nothing here is awaited: screens keep their
 * own skeletons, the loader only moves the requests earlier. Every call uses the same query
 * options as the screen, so the screen picks up the same cache entry.
 */
export const prefetch = {
  shell(queryClient: QueryClient, userId: string) {
    withClient((client) => {
      void queryClient.prefetchQuery(myProfileQueryOptions(client, userId))
      void queryClient.prefetchQuery(unreadCountQueryOptions(client, userId))
    })
  },

  home(queryClient: QueryClient, userId: string) {
    withClient((client) => {
      void queryClient.prefetchQuery(planQueries.homeBalances(client, userId))
      void queryClient.prefetchQuery(planQueries.timeline(client, timelineRange()))
      void queryClient.prefetchQuery(planQueries.groups(client))
    })
  },

  plans(queryClient: QueryClient) {
    withClient((client) => {
      const range = timelineRange()
      void queryClient.prefetchQuery(planQueries.timeline(client, range))
      void queryClient.prefetchQuery(planQueries.past(client, range.from))
      void queryClient.prefetchQuery(planQueries.groups(client))
    })
  },

  groups(queryClient: QueryClient, userId: string) {
    withClient((client) => {
      void queryClient.prefetchQuery(myGroupsQueryOptions(client, userId))
    })
  },

  group(queryClient: QueryClient, groupId: string, userId: string) {
    withClient((client) => {
      void queryClient.prefetchQuery(groupDetailQueryOptions(client, groupId, userId))
      void queryClient.prefetchQuery(moneyQueries.group(client, groupId))
      void queryClient.prefetchQuery(moneyQueries.people(client))
    })
  },

  expenses(queryClient: QueryClient, groupId: string) {
    withClient((client) => {
      void queryClient.prefetchQuery(moneyQueries.expenses(client, groupId))
      void queryClient.prefetchQuery(moneyQueries.settlements(client, groupId))
      void queryClient.prefetchQuery(moneyQueries.recurring(client, groupId))
    })
  },

  balances(queryClient: QueryClient, groupId: string) {
    withClient((client) => {
      void queryClient.prefetchQuery(moneyQueries.balances(client, groupId))
      void queryClient.prefetchQuery(moneyQueries.simplified(client, groupId))
      void queryClient.prefetchQuery(moneyQueries.expenses(client, groupId))
      void queryClient.prefetchQuery(moneyQueries.settlements(client, groupId))
    })
  },

  event(queryClient: QueryClient, eventId: string) {
    withClient((client) => {
      // Members need the group id and the panels depend on the status, so they follow the event.
      void queryClient
        .ensureQueryData(planQueries.event(client, eventId))
        .then((event) => {
          void queryClient.prefetchQuery(planQueries.members(client, event.group_id))
          if (event.status === 'polling') {
            void queryClient.prefetchQuery(planQueries.availability(client, eventId))
            void queryClient.prefetchQuery(planQueries.bestSlots(client, eventId))
            void queryClient.prefetchQuery(planQueries.requests(client, eventId))
          } else {
            void queryClient.prefetchQuery(planQueries.rsvps(client, eventId))
          }
        })
        .catch(() => undefined)
      void queryClient.prefetchQuery(planQueries.comments(client, eventId))
    })
  },

  activity(queryClient: QueryClient) {
    withClient((client) => {
      void queryClient.prefetchInfiniteQuery(activityInfiniteQueryOptions(client))
      void queryClient.prefetchQuery(moneyQueries.people(client))
    })
  },

  notifications(queryClient: QueryClient, userId: string) {
    withClient((client) => {
      void queryClient.prefetchQuery(notificationsQueryOptions(client, userId))
    })
  },
}
