import { groupKeys } from '@potluck/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emitChange, resetDb, rowsOf, subscriptions } from '@/test/supabase'
import { useAllGroupsRealtime, useMyGroupsRealtime } from './use-groups'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'u-ava' }))

const group = (id: string) => ({ id, name: id, group_members: [] })
const TABLES = [{ table: 'expenses' }]

let client: QueryClient
function render(hook: () => void) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(hook, { wrapper })
}

describe('group scoped realtime', () => {
  beforeEach(() => {
    resetDb({ tables: { groups: [group('g-2'), group('g-1')], group_balances: [] } })
  })

  it("filters every table to the viewer's groups and watches their own joins", async () => {
    render(() => useAllGroupsRealtime())
    await waitFor(() => expect(subscriptions()).toHaveLength(5))
    expect(subscriptions()).toEqual([
      { table: 'group_members', filter: 'group_id=in.(g-1,g-2)' },
      { table: 'expenses', filter: 'group_id=in.(g-1,g-2)' },
      { table: 'settlements', filter: 'group_id=in.(g-1,g-2)' },
      // Realtime cannot filter deletes.
      { table: 'group_members', filter: undefined },
      { table: 'group_members', filter: 'user_id=eq.u-ava' },
    ])
  })

  it('waits for the group list before subscribing', () => {
    render(() => useMyGroupsRealtime('test', TABLES, () => []))
    expect(subscriptions()).toEqual([])
  })

  it('only watches joins while the viewer has no groups', async () => {
    resetDb({ tables: { groups: [], group_balances: [] } })
    render(() => useMyGroupsRealtime('test', TABLES, () => []))
    await waitFor(() =>
      expect(subscriptions()).toEqual([{ table: 'group_members', filter: 'user_id=eq.u-ava' }]),
    )
  })

  it('refreshes the group list when the viewer joins one, then listens to it too', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(() => useMyGroupsRealtime('test', TABLES, () => [['bumped']]))
      await waitFor(() => expect(subscriptions()).toHaveLength(2))
      const invalidate = vi.spyOn(client, 'invalidateQueries')

      rowsOf('groups').push(group('g-3'))
      act(() => emitChange('group_members', 'INSERT', { user_id: 'u-ava', group_id: 'g-3' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })

      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['bumped'] })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: groupKeys.list('u-ava') })
      await waitFor(() =>
        expect(subscriptions()).toContainEqual({
          table: 'expenses',
          filter: 'group_id=in.(g-1,g-2,g-3)',
        }),
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
