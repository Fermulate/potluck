import { moneyKeys } from '@potluck/api'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderInRouter } from '@/features/expenses/router-test-utils'
import { BEN, GROUP_ID, ME, expense, seededClient } from '@/features/expenses/test-utils'
import { PlanExpenses } from './plan-expenses'

vi.mock('@/lib/supabase', () => import('@/features/expenses/fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))

const EVENT = '20000000-0000-4000-8000-000000000009'

function setup(expenses: ReturnType<typeof expense>[]) {
  const client = seededClient((c) => c.setQueryData(moneyKeys.expenses(GROUP_ID), expenses))
  return renderInRouter(
    <>
      <p>Plan page</p>
      <PlanExpenses groupId={GROUP_ID} eventId={EVENT} />
    </>,
    client,
  )
}

describe('PlanExpenses', () => {
  it('lists only the expenses filed under the plan, with a running total', async () => {
    setup([
      expense({ id: 'e1', description: 'Groceries', event_id: EVENT, paid_by: ME }),
      expense({ id: 'e2', description: 'Wine', event_id: EVENT, paid_by: BEN, amount_cents: 4500 }),
      expense({ id: 'e3', description: 'Unrelated taxi', event_id: null }),
    ])
    expect(await screen.findByRole('heading', { name: 'On the tab' })).toBeInTheDocument()
    expect(screen.getByText('Groceries')).toBeInTheDocument()
    expect(screen.getByText('Wine')).toBeInTheDocument()
    expect(screen.queryByText('Unrelated taxi')).not.toBeInTheDocument()
    expect(screen.getByText('$75.00 so far')).toBeInTheDocument()
  })

  it('stays out of the way when nothing is filed yet', async () => {
    setup([expense({ id: 'e3', description: 'Taxi', event_id: null })])
    expect(await screen.findByText('Plan page')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'On the tab' })).not.toBeInTheDocument()
    expect(screen.queryByText('Taxi')).not.toBeInTheDocument()
  })
})
