import { moneyKeys, type RecurringExpense } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { db, resetDb, rowsOf } from '@/test/supabase'
import { BEN, GROUP_ID, ME, seededClient } from '../expenses/test-utils'
import { RecurringSection } from './recurring-section'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))

function recurring(patch: Partial<RecurringExpense>): RecurringExpense {
  return {
    id: 'r-rent',
    group_id: GROUP_ID,
    description: 'Rent',
    amount_cents: 120000,
    currency: 'USD',
    paid_by: ME,
    category: 'rent',
    recurrence: 'monthly',
    next_run_on: '2026-12-01',
    active: true,
    created_by: ME,
    ...patch,
  } as RecurringExpense
}

const rows = [
  recurring({}),
  recurring({
    id: 'r-net',
    description: 'Internet',
    amount_cents: 6000,
    paid_by: BEN,
    created_by: BEN,
    recurrence: 'weekly',
    active: false,
  }),
]

function renderSection(list = rows) {
  resetDb({ tables: { recurring_expenses: list.map((r) => ({ ...r })) } })
  const client = seededClient((c) => c.setQueryData(moneyKeys.recurring(GROUP_ID), list))
  return renderWithProviders(
    <>
      <RecurringSection groupId={GROUP_ID} />
      <Toaster label="Notifications" />
    </>,
    { client },
  )
}

async function expand() {
  const toggle = await screen.findByRole('button', { name: /Repeating/ })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(toggle).toHaveTextContent(
    [
      t('expenses.recurring.activeCount', { count: 1 }),
      t('expenses.recurring.pausedCount', { count: 1 }),
    ].join(', '),
  )
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
}

const row = (name: string) => screen.getByText(name).closest('li')!

describe('RecurringSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stays hidden when nothing repeats', async () => {
    const { router } = renderSection([])
    await waitFor(() => expect(router.state.status).toBe('idle'))
    expect(screen.queryByRole('button', { name: /Repeating/ })).not.toBeInTheDocument()
  })

  it('leaves paused out of the summary when everything runs', async () => {
    renderSection([rows[0]!])
    const toggle = await screen.findByRole('button', { name: /Repeating/ })
    expect(toggle).toHaveTextContent(t('expenses.recurring.activeCount', { count: 1 }))
    expect(toggle).not.toHaveTextContent(/paused/)
  })

  it('folds out the schedule for each repeating expense', async () => {
    renderSection()
    await expand()
    expect(within(row('Rent')).getByText(/^Monthly, /)).toBeInTheDocument()
    expect(within(row('Rent')).getByText(/Next on/)).toBeInTheDocument()
    expect(within(row('Internet')).getByText(t('expenses.recurring.paused'))).toBeInTheDocument()
    // Only the creator (or an admin) manages one.
    expect(
      within(row('Internet')).queryByRole('button', { name: t('expenses.recurring.resume') }),
    ).not.toBeInTheDocument()
  })

  it('pauses one of yours', async () => {
    renderSection()
    await expand()
    fireEvent.click(
      within(row('Rent')).getByRole('button', { name: t('expenses.recurring.pause') }),
    )
    expect(
      await screen.findByText(t('expenses.recurring.pausedToast', { description: 'Rent' })),
    ).toBeInTheDocument()
    expect(rowsOf('recurring_expenses').find((r) => r.id === 'r-rent')?.active).toBe(false)
  })

  it('puts it back and explains when pausing fails', async () => {
    renderSection()
    await expand()
    db().respond('from:recurring_expenses', { error: { message: 'not_allowed' } })
    fireEvent.click(
      within(row('Rent')).getByRole('button', { name: t('expenses.recurring.pause') }),
    )
    expect(await screen.findByText(t('expenses.errors.not_allowed'))).toBeInTheDocument()
    await waitFor(() =>
      expect(
        within(row('Rent')).getByRole('button', { name: t('expenses.recurring.pause') }),
      ).toBeInTheDocument(),
    )
  })

  it('stops one repeating after confirming', async () => {
    renderSection()
    await expand()
    fireEvent.click(
      within(row('Rent')).getByRole('button', { name: t('expenses.recurring.remove') }),
    )
    const dialog = await screen.findByRole('dialog', { name: t('expenses.recurring.remove') })
    fireEvent.click(within(dialog).getByRole('button', { name: t('expenses.recurring.remove') }))
    expect(
      await screen.findByText(t('expenses.recurring.removedToast', { description: 'Rent' })),
    ).toBeInTheDocument()
    expect(rowsOf('recurring_expenses').map((r) => r.id)).toEqual(['r-net'])
  })

  it('reports a failed stop', async () => {
    renderSection()
    await expand()
    db().respond('from:recurring_expenses', { error: { message: 'Server error' } })
    fireEvent.click(
      within(row('Rent')).getByRole('button', { name: t('expenses.recurring.remove') }),
    )
    const dialog = await screen.findByRole('dialog', { name: t('expenses.recurring.remove') })
    fireEvent.click(within(dialog).getByRole('button', { name: t('expenses.recurring.remove') }))
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument()
  })
})
