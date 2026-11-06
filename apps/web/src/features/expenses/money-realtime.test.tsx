import { moneyKeys } from '@potluck/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emitChange, resetDb } from '@/test/supabase'
import { useGroupMoneyRealtime } from './money-data'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'me' }))

let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

describe('useGroupMoneyRealtime', () => {
  beforeEach(() => {
    resetDb()
    client = new QueryClient()
  })

  it('refetches the group money and the expense that changed', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderHook(() => useGroupMoneyRealtime('g1'), { wrapper })

    emitChange('expenses', 'UPDATE', { id: 'x1' })
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: moneyKeys.expense('x1') }),
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: moneyKeys.group('g1') })
  })

  it('keeps listening when another screen on the same group closes', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const list = renderHook(() => useGroupMoneyRealtime('g1'), { wrapper })
    renderHook(() => useGroupMoneyRealtime('g1'), { wrapper })
    list.unmount()

    emitChange('settlements', 'INSERT', {})
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: moneyKeys.group('g1') }),
    )
  })
})
