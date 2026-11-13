import type * as Api from '@potluck/api'
import { makeExpenseRecurring, moneyKeys, skipRecurring } from '@potluck/api'
import { formatDate, t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import {
  BEN,
  CLEO,
  GROUP_ID,
  ME,
  expense,
  group,
  seededClient,
} from '@/features/expenses/test-utils'
import { RecurringEditScreen } from './recurring-edit'
import { RepeatCard } from './repeat-card'
import { template } from './test-utils'

vi.mock('@/lib/supabase', () => import('@/features/expenses/fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))
vi.mock('@potluck/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  makeExpenseRecurring: vi.fn(async (_c: unknown, _id: string, recurrence: Api.RecurrenceValue) =>
    template({ id: 'r-new', recurrence, next_run_on: '2099-01-04' }),
  ),
  skipRecurring: vi.fn(async () => template({ next_run_on: '2100-01-01' })),
  setRecurringActive: vi.fn(async () => undefined),
  deleteRecurring: vi.fn(async () => undefined),
}))

const day = (date: string) => formatDate(date, { timeZone: 'UTC', style: 'weekday' })

function renderCard(props: Partial<Parameters<typeof RepeatCard>[0]> = {}, rows = [template()]) {
  const client = seededClient((c) => {
    for (const r of rows) c.setQueryData(moneyKeys.recurringOne(r.id), r)
  })
  return renderWithProviders(
    <>
      <RepeatCard
        expense={expense({ spent_at: '2099-01-01' })}
        canManage={() => true}
        canMakeRepeat
        timeZone="UTC"
        {...props}
      />
      <Toaster label="Notifications" />
    </>,
    { client },
  )
}

describe('RepeatCard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the series a posted copy belongs to, with a way into it', async () => {
    renderCard({ expense: expense({ recurring_id: 'r1' }) })
    const card = await screen.findByRole('region', { name: t('expenses.recurring.card.title') })
    expect(card).toHaveTextContent(
      t('expenses.recurring.card.next', { every: 'Monthly', date: day('2099-12-01') }),
    )
    expect(
      within(card).getByRole('link', { name: t('expenses.recurring.card.edit') }),
    ).toHaveAttribute('href', '/recurring/r1')
  })

  it('says when the series is paused, and offers details to people who cannot change it', async () => {
    renderCard({ expense: expense({ recurring_id: 'r1' }), canManage: () => false }, [
      template({ active: false }),
    ])
    const card = await screen.findByRole('region', { name: t('expenses.recurring.card.title') })
    expect(card).toHaveTextContent(t('expenses.recurring.card.paused', { every: 'Monthly' }))
    expect(
      within(card).getByRole('link', { name: t('expenses.recurring.card.view') }),
    ).toBeVisible()
  })

  it('makes an expense repeat from the interval picked, showing when the first copy comes', async () => {
    renderCard()
    fireEvent.click(
      await screen.findByRole('button', { name: t('expenses.recurring.make.action') }),
    )
    const sheet = await screen.findByRole('dialog', { name: t('expenses.recurring.make.title') })
    expect(sheet).toHaveTextContent(t('expenses.recurring.make.first', { date: day('2099-02-01') }))
    fireEvent.click(within(sheet).getByRole('radio', { name: t('expenses.recurrence.biweekly') }))
    expect(sheet).toHaveTextContent(t('expenses.recurring.make.first', { date: day('2099-01-15') }))
    fireEvent.click(
      within(sheet).getByRole('button', { name: t('expenses.recurring.make.confirm') }),
    )
    await waitFor(() => expect(makeExpenseRecurring).toHaveBeenCalledTimes(1))
    expect(vi.mocked(makeExpenseRecurring).mock.calls[0]!.slice(1)).toEqual([
      'e0000000-0000-4000-8000-000000000001',
      'biweekly',
    ])
    expect(
      await screen.findByText(
        t('expenses.recurring.make.doneToast', { description: 'Rent', date: day('2099-01-04') }),
      ),
    ).toBeVisible()
  })

  it('offers nothing when the expense cannot repeat', async () => {
    const { router } = renderCard({ canMakeRepeat: false })
    await waitFor(() => expect(router.state.status).toBe('idle'))
    expect(screen.queryByRole('button', { name: t('expenses.recurring.make.action') })).toBeNull()
  })
})

describe('RecurringEditScreen', () => {
  beforeEach(() => vi.clearAllMocks())

  function renderScreen(rows: (Api.RecurringExpense | null)[], role: 'member' | 'owner' = 'owner') {
    const client = seededClient((c) => {
      c.setQueryData(moneyKeys.recurringOne('r1'), rows[0])
      c.setQueryData(moneyKeys.groupInfo(GROUP_ID), {
        ...group,
        members: group.members.map((m) => (m.id === ME ? { ...m, role } : m)),
      })
    })
    return renderWithProviders(
      <>
        <RecurringEditScreen recurringId="r1" />
        <Toaster label="Notifications" />
      </>,
      { client },
    )
  }

  it('opens the form with skip, pause and stop for whoever set it up', async () => {
    renderScreen([template()])
    expect(await screen.findByRole('textbox', { name: 'Amount' })).toHaveValue('1500')
    const actions = screen.getByRole('group', { name: t('expenses.recurring.actions') })
    fireEvent.click(within(actions).getByRole('button', { name: t('expenses.recurring.skip') }))
    const dialog = await screen.findByRole('dialog', { name: t('expenses.recurring.skipTitle') })
    expect(dialog).toHaveTextContent(
      t('expenses.recurring.skipConfirm', {
        description: 'Rent',
        date: day('2099-12-01'),
        next: day('2100-01-01'),
      }),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: t('expenses.recurring.skip') }))
    await waitFor(() => expect(skipRecurring).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByText(
        t('expenses.recurring.skippedToast', { description: 'Rent', date: day('2100-01-01') }),
      ),
    ).toBeVisible()
  })

  it('shows who pays and how it splits to a member who is not in it', async () => {
    renderScreen(
      [template({ created_by: BEN, paid_by: BEN, splits: [{ user_id: BEN }, { user_id: CLEO }] })],
      'member',
    )
    expect(await screen.findByText(t('expenses.recurring.readOnly'))).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Amount' })).toBeNull()
    expect(
      screen.getByText(t('expenses.paidSummary', { name: 'Ben', amount: '$1,500.00' })),
    ).toBeVisible()
    const split = screen.getByRole('region', { name: t('expenses.fields.splitBetween') })
    expect(
      within(split)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Ben$750.00', 'Cleo$750.00'])
    expect(screen.queryByText(/Your share each time/)).toBeNull()
  })

  it('lets someone in the split change it, as with expenses', async () => {
    renderScreen([template({ created_by: BEN, paid_by: BEN })], 'member')
    expect(await screen.findByRole('textbox', { name: 'Amount' })).toHaveValue('1500')
  })

  it('says who left and keeps it paused until they are out of the split', async () => {
    const gone = 'dddddddd-0000-4000-8000-000000000004'
    renderScreen([template({ active: false, splits: [{ user_id: ME }, { user_id: gone }] })])
    expect(
      await screen.findByText(t('expenses.recurring.formerNote', { names: 'Former' })),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: t('expenses.recurring.resume') })).toBeDisabled()
    expect(
      screen.getByText(new RegExp(t('expenses.recurring.resumeBlocked', { names: 'Former' }))),
    ).toBeVisible()
  })
  it('says when it was stopped', async () => {
    renderScreen([null])
    expect(await screen.findByText(t('expenses.recurring.notFound'))).toBeVisible()
  })

  it('pauses with a note that nothing goes in until it resumes', async () => {
    renderScreen([template({ active: false })])
    expect(await screen.findByText(t('expenses.recurring.pausedNote'))).toBeVisible()
    expect(screen.queryByRole('button', { name: t('expenses.recurring.skip') })).toBeNull()
    expect(screen.getByRole('button', { name: t('expenses.recurring.resume') })).toBeVisible()
  })
})
