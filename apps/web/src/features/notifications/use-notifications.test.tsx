import type * as AuthModule from '@/lib/auth'
import { groupKeys, meKeys } from '@potluck/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { VIEWER } from '@/test/fixtures'
import { emitChange, resetDb, subscribedTables } from '@/test/supabase'
import { useNotificationsRealtime } from './use-notifications'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

async function listen() {
  resetDb()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(groupKeys.list(VIEWER), [{ id: 'g-hike' }])
  client.setQueryData(groupKeys.detail('g-hike'), { id: 'g-hike' })
  client.setQueryData(meKeys.notifications(VIEWER), [])
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  renderHook(() => useNotificationsRealtime(), { wrapper })
  await waitFor(() => expect(subscribedTables()).toContain('notifications'))
  return (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated
}

describe('useNotificationsRealtime', () => {
  it.each(['group.deleted', 'group.restored'])(
    'refreshes every group screen when a %s notification arrives',
    async (type) => {
      const stale = await listen()
      emitChange('notifications', 'INSERT', { user_id: VIEWER, type })
      expect(stale(meKeys.notifications(VIEWER))).toBe(true)
      expect(stale(groupKeys.list(VIEWER))).toBe(true)
      expect(stale(groupKeys.detail('g-hike'))).toBe(true)
    },
  )

  it('leaves the groups alone for other news', async () => {
    const stale = await listen()
    emitChange('notifications', 'INSERT', { user_id: VIEWER, type: 'expense.added' })
    expect(stale(meKeys.notifications(VIEWER))).toBe(true)
    expect(stale(groupKeys.list(VIEWER))).toBe(false)
  })
})
