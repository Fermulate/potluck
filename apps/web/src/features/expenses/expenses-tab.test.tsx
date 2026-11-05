import { moneyKeys } from '@potluck/api'
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExpensesTab } from './expenses-tab'
import { renderInRouter } from './router-test-utils'
import { BEN, CLEO, GROUP_ID, ME, expense, seededClient } from './test-utils'

vi.mock('@/lib/supabase', () => import('./fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))

function setup() {
  const client = seededClient((c) => {
    c.setQueryData(moneyKeys.expenses(GROUP_ID), [
      expense({ id: 'e1', description: 'Tacos', paid_by: ME }),
      expense({
        id: 'e2',
        description: 'Gas for two cars',
        category: 'gas',
        paid_by: BEN,
        spent_at: '2026-11-03',
      }),
      expense({
        id: 'e3',
        description: 'Firewood',
        category: 'other',
        paid_by: CLEO,
        spent_at: '2026-11-02',
        expense_splits: [
          { user_id: BEN, share_cents: 1500, weight: null },
          { user_id: CLEO, share_cents: 1500, weight: null },
        ],
      }),
    ])
    c.setQueryData(moneyKeys.settlements(GROUP_ID), [])
  })
  return renderInRouter(<ExpensesTab groupId={GROUP_ID} />, client)
}

describe('ExpensesTab', () => {
  it('says what each expense means for you', async () => {
    setup()
    const tacos = (await screen.findByText('Tacos')).closest('a')!
    expect(within(tacos).getByText('You paid $30.00')).toBeInTheDocument()
    expect(within(tacos).getByText('you lent $20.00')).toBeInTheDocument()

    const gas = screen.getByText('Gas for two cars').closest('a')!
    expect(within(gas).getByText('Ben paid $30.00')).toBeInTheDocument()
    expect(within(gas).getByText('you borrowed $10.00')).toBeInTheDocument()

    const firewood = screen.getByText('Firewood').closest('a')!
    expect(within(firewood).getByText('not involved')).toBeInTheDocument()
  })

  it('links each row to the expense', async () => {
    setup()
    const row = (await screen.findByText('Tacos')).closest('a')!
    expect(row).toHaveAttribute('href', '/expenses/e1')
  })

  it('filters by search and by category', async () => {
    setup()
    await screen.findByText('Tacos')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search expenses' }), {
      target: { value: 'fire' },
    })
    expect(await screen.findByText('Firewood')).toBeInTheDocument()
    expect(screen.queryByText('Tacos')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search expenses' }), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Gas/ }))
    expect(await screen.findByText('Gas for two cars')).toBeInTheDocument()
    expect(screen.queryByText('Tacos')).not.toBeInTheDocument()
  })

  it('shows the empty state when nothing has been added yet', async () => {
    const client = seededClient((c) => {
      c.setQueryData(moneyKeys.expenses(GROUP_ID), [])
      c.setQueryData(moneyKeys.settlements(GROUP_ID), [])
    })
    renderInRouter(<ExpensesTab groupId={GROUP_ID} />, client)
    expect(await screen.findByRole('heading', { name: 'Nothing on the tab' })).toBeInTheDocument()
  })
})
