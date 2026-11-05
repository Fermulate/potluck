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
import { QueryClient, type QueryKey } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { timelineRange } from '@/features/plans/use-range'
import { planEvent } from '@/test/plan-fixtures'
import { resetDb, supabase } from '@/test/supabase'
import { prefetch } from './prefetch'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

const ME = 'u-ava'

let queryClient: QueryClient

function started(key: QueryKey) {
  return queryClient.getQueryCache().find({ queryKey: key, exact: true }) !== undefined
}

/** Waits until every key has a cache entry, which is what the screen picks up. */
async function expectWarmed(...keys: QueryKey[]) {
  await vi.waitFor(() => {
    for (const key of keys) expect(started(key), JSON.stringify(key)).toBe(true)
  })
}

beforeEach(() => {
  resetDb()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

describe('route prefetch', () => {
  it('starts the shell, home and plans queries', async () => {
    const range = timelineRange()
    prefetch.shell(queryClient, ME)
    prefetch.home(queryClient, ME)
    prefetch.plans(queryClient)
    await expectWarmed(
      myProfileQueryOptions(supabase, ME).queryKey,
      unreadCountQueryOptions(supabase, ME).queryKey,
      planQueries.homeBalances(supabase, ME).queryKey,
      planQueries.timeline(supabase, range).queryKey,
      planQueries.past(supabase, range.from).queryKey,
      planQueries.groups(supabase).queryKey,
    )
  })

  it('starts a group, its expenses and its balances', async () => {
    prefetch.groups(queryClient, ME)
    prefetch.group(queryClient, 'g-hike', ME)
    prefetch.expenses(queryClient, 'g-hike')
    prefetch.balances(queryClient, 'g-hike')
    await expectWarmed(
      myGroupsQueryOptions(supabase, ME).queryKey,
      groupDetailQueryOptions(supabase, 'g-hike', ME).queryKey,
      moneyQueries.group(supabase, 'g-hike').queryKey,
      moneyQueries.people(supabase).queryKey,
      moneyQueries.expenses(supabase, 'g-hike').queryKey,
      moneyQueries.settlements(supabase, 'g-hike').queryKey,
      moneyQueries.recurring(supabase, 'g-hike').queryKey,
      moneyQueries.balances(supabase, 'g-hike').queryKey,
      moneyQueries.simplified(supabase, 'g-hike').queryKey,
    )
  })

  it('starts the activity feed and notifications', async () => {
    prefetch.activity(queryClient)
    prefetch.notifications(queryClient, ME)
    await expectWarmed(
      activityInfiniteQueryOptions(supabase).queryKey,
      moneyQueries.people(supabase).queryKey,
      notificationsQueryOptions(supabase, ME).queryKey,
    )
  })

  it('follows a polling plan with its availability, best times and requests', async () => {
    resetDb({ tables: { events: [planEvent({ status: 'polling' })] } })
    prefetch.event(queryClient, 'ev-1')
    await expectWarmed(
      planQueries.event(supabase, 'ev-1').queryKey,
      planQueries.comments(supabase, 'ev-1').queryKey,
      planQueries.members(supabase, 'g-hike').queryKey,
      planQueries.availability(supabase, 'ev-1').queryKey,
      planQueries.bestSlots(supabase, 'ev-1').queryKey,
      planQueries.requests(supabase, 'ev-1').queryKey,
    )
    expect(started(planQueries.rsvps(supabase, 'ev-1').queryKey)).toBe(false)
  })

  it('follows a locked in plan with its RSVPs instead', async () => {
    resetDb({ tables: { events: [planEvent({ status: 'scheduled' })] } })
    prefetch.event(queryClient, 'ev-1')
    await expectWarmed(
      planQueries.members(supabase, 'g-hike').queryKey,
      planQueries.rsvps(supabase, 'ev-1').queryKey,
    )
    expect(started(planQueries.availability(supabase, 'ev-1').queryKey)).toBe(false)
  })

  it('still starts the comments when the plan cannot be found', async () => {
    resetDb({ tables: { events: [] } })
    prefetch.event(queryClient, 'ev-gone')
    await expectWarmed(planQueries.comments(supabase, 'ev-gone').queryKey)
    await vi.waitFor(() =>
      expect(
        queryClient.getQueryState(planQueries.event(supabase, 'ev-gone').queryKey)?.status,
      ).toBe('error'),
    )
    expect(started(planQueries.rsvps(supabase, 'ev-gone').queryKey)).toBe(false)
  })
})
