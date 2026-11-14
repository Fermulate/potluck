import { moneyKeys, type RecurringExpense } from '@potluck/api'
import { t } from '@potluck/i18n'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { MoneyFilters } from '@/features/insights/filter-state'
import { ExpensesTab } from './expenses-tab'
import { renderInRouter } from './router-test-utils'
import { BEN, CLEO, GROUP_ID, ME, expense, seededClient } from './test-utils'

vi.mock('@/lib/supabase', () => import('./fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))

/** The tab with its filters held in state, the way the route holds them in the address. */
function Tab({ initial = {} }: { initial?: MoneyFilters }) {
  const [filters, setFilters] = useState<MoneyFilters>(initial)
  return <ExpensesTab groupId={GROUP_ID} filters={filters} onFiltersChange={setFilters} />
}

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
  return renderInRouter(<Tab />, client)
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

  it('links to the group activity from the toolbar', async () => {
    setup()
    await screen.findByText('Tacos')
    const link = screen.getByRole('link', { name: t('insights.links.activity') })
    expect(link.getAttribute('href')).toMatch(/^\/activity\?groupId=/)
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

  it('filters by person and dates from the sheet, with a matching total', async () => {
    setup()
    await screen.findByText('Tacos')
    fireEvent.click(screen.getByRole('button', { name: t('filters.open') }))
    const sheet = await screen.findByRole('dialog', { name: t('filters.title') })
    // Ben paid for the gas and is in the split for the tacos and the firewood.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ben Okafor' }))
    fireEvent.click(within(sheet).getByRole('button', { name: t('filters.custom') }))
    fireEvent.change(within(sheet).getByLabelText(t('filters.from')), {
      target: { value: '2026-11-03' },
    })
    fireEvent.change(within(sheet).getByLabelText(t('filters.to')), {
      target: { value: '2026-11-04' },
    })
    fireEvent.click(within(sheet).getByRole('button', { name: t('filters.done') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await waitFor(() => expect(screen.queryByText('Firewood')).not.toBeInTheDocument())
    expect(screen.getByText('Tacos')).toBeInTheDocument()
    expect(screen.getByText('Gas for two cars')).toBeInTheDocument()
    expect(
      screen.getByText(t('filters.summary', { count: 2, total: '$60.00' })),
    ).toBeInTheDocument()
    expect(screen.getByText(t('filters.yourShare', { amount: '$20.00' }))).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: t('filters.openActive', { count: 2 }) }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t('filters.remove', { filter: 'Ben' }) }))
    expect(
      await screen.findByText(t('filters.summary', { count: 2, total: '$60.00' })),
    ).toBeInTheDocument()
  })

  function withPayment() {
    return seededClient((c) => {
      c.setQueryData(moneyKeys.expenses(GROUP_ID), [
        expense({ id: 'e1', description: 'Tacos', category: 'food' }),
      ])
      c.setQueryData(moneyKeys.settlements(GROUP_ID), [
        {
          id: 's1',
          group_id: GROUP_ID,
          from_user: BEN,
          to_user: ME,
          amount_cents: 1000,
          currency: 'USD',
          fx_rate: '1.000000000000',
          note: 'Cash for tacos',
          settled_at: '2026-11-04T10:00:00Z',
          created_by: BEN,
          created_at: '2026-11-04T10:00:00Z',
          deleted_at: null,
        },
      ])
    })
  }

  it('keeps payments that match a person filter, and takes filters from the caller', async () => {
    const changes: unknown[] = []
    renderInRouter(
      <ExpensesTab
        groupId={GROUP_ID}
        filters={{ person: BEN }}
        onFiltersChange={(next) => changes.push(next)}
      />,
      withPayment(),
    )
    expect(await screen.findByText('Cash for tacos')).toBeInTheDocument()
    expect(screen.getByText('Tacos')).toBeInTheDocument()
    expect(screen.queryByText(t('filters.paymentsHidden'))).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('filters.remove', { filter: 'Ben' }) }))
    expect(changes).toEqual([{ person: null }])
  })

  it('leaves payments out of a category filter and says so', async () => {
    renderInRouter(<Tab initial={{ categories: ['food'] }} />, withPayment())
    expect(await screen.findByText(t('filters.paymentsHidden'))).toBeInTheDocument()
    expect(screen.getByText('Tacos')).toBeInTheDocument()
    expect(screen.queryByText('Cash for tacos')).not.toBeInTheDocument()
  })

  it('finds subcategories under a top level category filter', async () => {
    const client = seededClient((c) => {
      c.setQueryData(moneyKeys.expenses(GROUP_ID), [
        expense({ id: 'e1', description: 'Tacos', category: 'food' }),
        expense({ id: 'e2', description: 'Cab home', category: 'taxi' }),
        expense({ id: 'e3', description: 'Train out', category: 'public_transit' }),
      ])
      c.setQueryData(moneyKeys.settlements(GROUP_ID), [])
    })
    renderInRouter(<Tab initial={{ categories: ['transport'] }} />, client)
    expect(await screen.findByText('Cab home')).toBeInTheDocument()
    expect(screen.getByText('Train out')).toBeInTheDocument()
    expect(screen.queryByText('Tacos')).not.toBeInTheDocument()
  })

  it('shows only payments or only expenses from the type filter', async () => {
    renderInRouter(<Tab />, withPayment())
    await screen.findByText('Cash for tacos')
    fireEvent.click(screen.getByRole('button', { name: t('filters.open') }))
    const sheet = await screen.findByRole('dialog', { name: t('filters.title') })
    fireEvent.click(within(sheet).getByRole('radio', { name: t('filters.payments') }))
    await waitFor(() => expect(screen.queryByText('Tacos')).not.toBeInTheDocument())
    expect(screen.getByText('Cash for tacos')).toBeInTheDocument()
    expect(screen.queryByText(/in all/)).not.toBeInTheDocument()

    fireEvent.click(within(sheet).getByRole('radio', { name: t('filters.expenses') }))
    await waitFor(() => expect(screen.queryByText('Cash for tacos')).not.toBeInTheDocument())
    expect(screen.getByText('Tacos')).toBeInTheDocument()
    expect(
      screen.getByText(t('filters.summary', { count: 1, total: '$30.00' })),
    ).toBeInTheDocument()
  })

  it('shows the empty state when nothing has been added yet', async () => {
    const client = seededClient((c) => {
      c.setQueryData(moneyKeys.expenses(GROUP_ID), [])
      c.setQueryData(moneyKeys.settlements(GROUP_ID), [])
    })
    renderInRouter(<Tab />, client)
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
    renderInRouter(<Tab />, client)
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
    renderInRouter(<Tab />, client)
    expect(await screen.findByRole('heading', { name: 'Nothing on the tab' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Repeating/ })).toBeInTheDocument()
  })
})
