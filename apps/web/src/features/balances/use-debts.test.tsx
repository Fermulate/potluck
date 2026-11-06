import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { db, resetDb } from '@/test/supabase'
import { BEN, GROUP_ID, ME, expense, group } from '../expenses/test-utils'
import { useDebts } from './use-debts'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

function renderDebts(simplify: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(() => useDebts(GROUP_ID, { ...group, simplify_debts: simplify }), { wrapper })
}

describe('useDebts', () => {
  it('asks the server for simplified debts without reading the whole ledger', async () => {
    resetDb({ tables: { expenses: [expense({})], settlements: [] } }).respond(
      'rpc:simplified_debts',
      { data: [{ from_user: BEN, to_user: ME, amount_cents: 1000 }] },
    )
    const { result } = renderDebts(true)

    await waitFor(() =>
      expect(result.current).toEqual([{ from_user: BEN, to_user: ME, amount_cents: 1000 }]),
    )
    expect(db().queries('expenses')).toHaveLength(0)
    expect(db().queries('settlements')).toHaveLength(0)
  })

  it('nets every pair from expenses and payments when simplifying is off', async () => {
    resetDb({ tables: { expenses: [expense({})], settlements: [] } })
    const { result } = renderDebts(false)

    await waitFor(() => expect(result.current).toHaveLength(2))
    expect(db().rpcArgs('simplified_debts')).toEqual([])
  })
})
