import { moneyKeys } from '@potluck/api'
import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderInRouter } from '@/features/expenses/router-test-utils'
import { BEN, CLEO, GROUP_ID, ME, seededClient } from '@/features/expenses/test-utils'
import { BalancesTab } from './balances-tab'

vi.mock('@/lib/supabase', () => import('@/features/expenses/fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))

describe('BalancesTab', () => {
  it('lists the debts you can act on before everyone else’s', async () => {
    const client = seededClient((c) => {
      c.setQueryData(moneyKeys.balances(GROUP_ID), [
        { user_id: ME, net_cents: -1000 },
        { user_id: BEN, net_cents: 3000 },
        { user_id: CLEO, net_cents: -2000 },
      ])
      c.setQueryData(moneyKeys.simplified(GROUP_ID), [
        { from_user: CLEO, to_user: BEN, amount_cents: 2000 },
        { from_user: ME, to_user: BEN, amount_cents: 1000 },
      ])
    })
    renderInRouter(<BalancesTab groupId={GROUP_ID} />, client)
    const list = (await screen.findByRole('heading', { name: 'Who pays whom' }))
      .closest('section')!
      .querySelector('ul')!
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('You owe Ben $10.00')
    expect(rows[1]).toHaveTextContent('Cleo owes Ben $20.00')
  })
})
