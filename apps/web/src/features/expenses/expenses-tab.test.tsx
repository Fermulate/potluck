import { moneyKeys, type RecurringExpense } from '@potluck/api'
import { t } from '@potluck/i18n'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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
          { user_id: BEN, share_cents: 1500, weight: null, adjustment_cents: null },
          { user_id: CLEO, share_cents: 1500, weight: null, adjustment_cents: null },
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

  it('links to the activity feed from the toolbar', async () => {
    setup()
    await screen.findByText('Tacos')
    expect(screen.getByRole('link', { name: t('activity.recent') })).toHaveAttribute(
      'href',
      '/activity',
    )
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

  it('waits for payments before calling the tab empty', async () => {
    const client = seededClient((c) => {
      c.setQueryData(moneyKeys.expenses(GROUP_ID), [])
      // Payments still on their way.
      void c.prefetchQuery({
        queryKey: moneyKeys.settlements(GROUP_ID),
        queryFn: () => new Promise<never>(() => {}),
      })
    })
    renderInRouter(<ExpensesTab groupId={GROUP_ID} />, client)
    await waitFor(() =>
      expect(document.querySelector('[aria-busy="true"]')).toHaveAttribute(
        'aria-label',
        t('expenses.loading'),
      ),
    )
    expect(screen.queryByRole('heading', { name: 'Nothing on the tab' })).not.toBeInTheDocument()
  })

  it('keeps repeating expenses reachable before the first one is due', async () => {
    const rent: RecurringExpense = {
      id: 'r1',
      group_id: GROUP_ID,
      description: 'Rent',
      amount_cents: 145000,
      currency: 'USD',
      paid_by: ME,
      payers: null,
      split_type: 'equal',
      category: 'rent',
      splits: [],
      items: null,
      tax_cents: null,
      tip_cents: null,
      discount_cents: null,
      recurrence: 'monthly',
      next_run_on: '2026-12-05',
      anchor_day: 5,
      active: true,
      remind: true,
      notes: null,
      created_by: ME,
      created_at: '2026-11-05T00:00:00Z',
      updated_at: '2026-11-05T00:00:00Z',
    }
    const client = seededClient((c) => {
      c.setQueryData(moneyKeys.expenses(GROUP_ID), [])
      c.setQueryData(moneyKeys.settlements(GROUP_ID), [])
      c.setQueryData(moneyKeys.recurring(GROUP_ID), [rent])
    })
    renderInRouter(<ExpensesTab groupId={GROUP_ID} />, client)
    expect(await screen.findByRole('heading', { name: 'Nothing on the tab' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Repeating/ })).toBeInTheDocument()
  })
})
