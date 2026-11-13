import type * as Api from '@potluck/api'
import { moneyKeys, updateRecurring } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExpenseForm } from '@/features/expenses/form/expense-form'
import {
  BEN,
  CLEO,
  GROUP_ID,
  ME,
  group,
  renderWithClient,
  seededClient,
} from '@/features/expenses/test-utils'
import { template } from './test-utils'

vi.mock('@/lib/supabase', () => import('@/features/expenses/fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))
vi.mock('@potluck/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  updateRecurring: vi.fn(async (_client: unknown, id: string, payload: Api.RecurringUpdate) => ({
    ...template({ id }),
    description: payload?.description ?? 'Rent',
  })),
}))

const update = vi.mocked(updateRecurring)

function open(row = template(), seed?: Parameters<typeof seededClient>[0]) {
  const onDone = vi.fn()
  const client = seededClient(seed)
  renderWithClient(
    <>
      <ExpenseForm
        mode="recurring"
        template={row}
        actions={<p>actions here</p>}
        onDone={onDone}
        onClose={() => {}}
      />
      <Toaster label="Notifications" />
    </>,
    client,
  )
  return { onDone, client }
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

describe('ExpenseForm for a repeating expense', () => {
  beforeEach(() => update.mockClear())

  it('opens with the amount, split and schedule, and says only future ones change', () => {
    open()
    expect(screen.getByRole('heading', { name: t('expenses.recurring.editTitle') })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveValue('1500')
    expect(screen.getByRole('textbox', { name: 'What was it?' })).toHaveValue('Rent')
    expect(screen.getByLabelText(t('expenses.recurring.nextLabel'))).toHaveValue('2099-12-01')
    expect(screen.getByText(t('expenses.recurring.futureOnly'))).toBeVisible()
    expect(screen.getByText('actions here')).toBeVisible()
    // An expense's extras do not apply to a schedule.
    expect(screen.queryByRole('switch', { name: t('expenses.refund.label') })).toBeNull()
    expect(screen.queryByRole('button', { name: t('expenses.fields.addReceipt') })).toBeNull()
    // Notes travel with every copy.
    expect(screen.getByRole('textbox', { name: t('expenses.fields.notes') })).toBeVisible()
  })

  it('saves a new amount with the split, and keeps the next date it already had', async () => {
    const { onDone } = open()
    fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), {
      target: { value: '1600' },
    })
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]![1]).toBe('r1')
    expect(update.mock.calls[0]![2]).toEqual({
      description: 'Rent',
      category: 'rent',
      amount_cents: 160000,
      currency: 'USD',
      paid_by: ME,
      payers: [{ user_id: ME, paid_cents: 160000 }],
      recurrence: 'monthly',
      notes: null,
      split_type: 'equal',
      splits: [{ user_id: ME }, { user_id: BEN }, { user_id: CLEO }],
    })
    expect(
      await screen.findByText(t('expenses.recurring.savedToast', { description: 'Rent' })),
    ).toBeVisible()
    expect(onDone).toHaveBeenCalledWith('r1')
  })

  it('sends a new date', async () => {
    open()
    fireEvent.change(screen.getByLabelText(t('expenses.recurring.nextLabel')), {
      target: { value: '2099-12-05' },
    })
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]![2]).toMatchObject({
      next_run_on: '2099-12-05',
    })
  })

  it('refuses a next date in the past', async () => {
    open()
    fireEvent.change(screen.getByLabelText(t('expenses.recurring.nextLabel')), {
      target: { value: '2001-01-01' },
    })
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t('expenses.errors.invalid_next_run'),
    )
    expect(update).not.toHaveBeenCalled()
  })

  it('reopens several payers and an adjustment split, and leaves an unchanged split alone', async () => {
    open(
      template({
        amount_cents: 160000,
        paid_by: ME,
        payers: [
          { user_id: ME, paid_cents: 100000 },
          { user_id: BEN, paid_cents: 60000 },
        ],
        split_type: 'adjustment',
        splits: [{ user_id: ME, adjustment_cents: 10000 }, { user_id: BEN }, { user_id: CLEO }],
      }),
    )
    expect(screen.getByText('You and Ben')).toBeVisible()
    fireEvent.change(screen.getByRole('textbox', { name: 'What was it?' }), {
      target: { value: 'Flat rent' },
    })
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    const payload = update.mock.calls[0]![2]
    expect(payload.description).toBe('Flat rent')
    expect(payload.payers).toEqual([
      { user_id: ME, paid_cents: 100000 },
      { user_id: BEN, paid_cents: 60000 },
    ])
    expect(payload).not.toHaveProperty('splits')
  })

  it('reopens a by-item bill and sends its items', async () => {
    open(
      template({
        amount_cents: 9000,
        split_type: 'itemized',
        splits: [
          { user_id: ME, share_cents: 5625 },
          { user_id: BEN, share_cents: 3375 },
        ],
        items: [
          { description: 'Pasta', amount_cents: 5000, user_ids: [ME] },
          { description: 'Salad', amount_cents: 3000, user_ids: [BEN] },
        ],
        tip_cents: 1000,
      }),
    )
    expect(screen.getByDisplayValue('Pasta')).toBeVisible()
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]![2]).toMatchObject({
      split_type: 'itemized',
      amount_cents: 9000,
      tip_cents: 1000,
      items: [
        { description: 'Pasta', amount_cents: 5000, user_ids: [ME] },
        { description: 'Salad', amount_cents: 3000, user_ids: [BEN] },
      ],
    })
  })

  it('asks to take someone who left out of the split before its money can change', async () => {
    const gone = 'dddddddd-0000-4000-8000-000000000004'
    open(template({ splits: [{ user_id: ME }, { user_id: gone }] }), (c) =>
      c.setQueryData(moneyKeys.groupInfo(GROUP_ID), group),
    )
    // Details still save without resending the split.
    fireEvent.change(screen.getByRole('textbox', { name: 'What was it?' }), {
      target: { value: 'Old rent' },
    })
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]![2]).not.toHaveProperty('splits')

    fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), {
      target: { value: '1600' },
    })
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Take .* out of the split/)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('follows a skip made while it is open without losing unsaved edits', async () => {
    const onDone = vi.fn()
    const client = seededClient()
    const view = (row: ReturnType<typeof template>) => (
      <ExpenseForm mode="recurring" template={row} onDone={onDone} onClose={() => {}} />
    )
    const { rerender } = renderWithClient(view(template()), client)
    fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), {
      target: { value: '1600' },
    })
    // Skipped elsewhere (the actions under the form): the next date moves on.
    rerender(
      <QueryClientProvider client={client}>
        {view(template({ next_run_on: '2100-01-01' }))}
      </QueryClientProvider>,
    )
    expect(screen.getByLabelText(t('expenses.recurring.nextLabel'))).toHaveValue('2100-01-01')
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveValue('1600')
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    // The new date came from the server, so it is not sent back.
    expect(update.mock.calls[0]![2]).not.toHaveProperty('next_run_on')
    expect(update.mock.calls[0]![2]).toMatchObject({ amount_cents: 160000 })
  })

  it('reports a server refusal', async () => {
    update.mockRejectedValueOnce({ message: 'not_allowed', code: '42501' })
    open()
    save()
    expect(await screen.findByText(t('expenses.errors.not_allowed'))).toBeVisible()
  })
})
