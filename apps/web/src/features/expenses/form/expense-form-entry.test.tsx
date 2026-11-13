import type * as Api from '@potluck/api'
import { createExpense, moneyKeys, setDefaultSplit, updateExpense } from '@potluck/api'
import { t } from '@potluck/i18n'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BEN,
  CLEO,
  GROUP_ID,
  ME,
  expense,
  group,
  members,
  renderWithClient,
  seededClient,
} from '../test-utils'
import { renderInRouter } from '../router-test-utils'
import { ExpenseForm } from './expense-form'

vi.mock('@/lib/supabase', () => import('../fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))
vi.mock('@potluck/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  createExpense: vi.fn(async () => ({ id: 'new-expense' })),
  updateExpense: vi.fn(async (_client: unknown, id: string) => ({ id })),
  setDefaultSplit: vi.fn(async (_client: unknown, _group: string, split: unknown) => split),
}))

const create = vi.mocked(createExpense)
const update = vi.mocked(updateExpense)
const saveDefault = vi.mocked(setDefaultSplit)

function setup(seed: (client: ReturnType<typeof seededClient>) => void = () => {}) {
  const onDone = vi.fn()
  renderWithClient(
    <ExpenseForm mode="create" groupId={GROUP_ID} onDone={onDone} onClose={() => {}} />,
    seededClient(seed),
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '90' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'What was it?' }), {
    target: { value: 'Dinner' },
  })
  return { onDone }
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))

beforeEach(() => {
  create.mockClear()
  update.mockClear()
  saveDefault.mockClear()
})

describe('several payers', () => {
  it('saves what each person paid, and refuses amounts that do not add up', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Paid by' }))
    const sheet = await screen.findByRole('dialog', { name: t('expenses.payers.title') })
    fireEvent.click(within(sheet).getByRole('radio', { name: t('expenses.payers.several') }))
    // Starts with whoever paid it all so far.
    expect(
      within(sheet).getByRole('textbox', { name: t('expenses.payers.amountOf', { name: 'You' }) }),
    ).toHaveValue('90')
    fireEvent.change(
      within(sheet).getByRole('textbox', { name: t('expenses.payers.amountOf', { name: 'You' }) }),
      { target: { value: '60' } },
    )
    expect(within(sheet).getByText('$30.00 left to assign')).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: t('expenses.payers.done') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    save()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t('errors.payers.payers_sum_mismatch'),
    )
    expect(create).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Paid by' }))
    const again = await screen.findByRole('dialog', { name: t('expenses.payers.title') })
    fireEvent.change(
      within(again).getByRole('textbox', { name: t('expenses.payers.amountOf', { name: 'Ben' }) }),
      { target: { value: '30' } },
    )
    expect(within(again).getByText('Everything adds up')).toBeInTheDocument()
    fireEvent.click(within(again).getByRole('button', { name: t('expenses.payers.done') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Paid by' })).toHaveTextContent('You and Ben')

    save()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]![1]).toMatchObject({
      paid_by: ME,
      payers: [
        { user_id: ME, paid_cents: 6000 },
        { user_id: BEN, paid_cents: 3000 },
      ],
    })
  })

  it('picks one payer with a tap and closes', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Paid by' }))
    const sheet = await screen.findByRole('dialog', { name: t('expenses.payers.title') })
    fireEvent.click(within(sheet).getByRole('button', { name: /Cleo/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    save()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]![1]).toMatchObject({
      paid_by: CLEO,
      payers: [{ user_id: CLEO, paid_cents: 9000 }],
    })
  })

  it('reopens an expense several people paid with their amounts', async () => {
    const saved = expense({
      amount_cents: 9000,
      expense_payers: [
        { user_id: ME, paid_cents: 6000 },
        { user_id: BEN, paid_cents: 3000 },
      ],
    })
    renderWithClient(
      <ExpenseForm mode="edit" expense={saved} onDone={() => {}} onClose={() => {}} />,
    )
    expect(screen.getByRole('button', { name: 'Paid by' })).toHaveTextContent('You and Ben')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]![2]).toMatchObject({
      payers: [
        { user_id: ME, paid_cents: 6000 },
        { user_id: BEN, paid_cents: 3000 },
      ],
    })
  })
})

describe('rest to someone', () => {
  it('gives what is still unpaid to the next person with nothing typed', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Paid by' }))
    const sheet = await screen.findByRole('dialog', { name: t('expenses.payers.title') })
    fireEvent.click(within(sheet).getByRole('radio', { name: t('expenses.payers.several') }))
    fireEvent.change(
      within(sheet).getByRole('textbox', { name: t('expenses.payers.amountOf', { name: 'You' }) }),
      { target: { value: '50' } },
    )
    fireEvent.click(
      within(sheet).getByRole('button', {
        name: t('expenses.payers.fillRestLabel', { amount: '$40.00', name: 'Ben' }),
      }),
    )
    expect(
      within(sheet).getByRole('textbox', { name: t('expenses.payers.amountOf', { name: 'Ben' }) }),
    ).toHaveValue('40')
    expect(within(sheet).getByText('Everything adds up')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: /Rest to/ })).not.toBeInTheDocument()
  })
})

describe('last currency', () => {
  it('opens at once in the group currency, then swaps in the remembered one', async () => {
    const client = seededClient((c) =>
      c.removeQueries({ queryKey: moneyKeys.lastCurrency(GROUP_ID, ME) }),
    )
    renderWithClient(
      <ExpenseForm mode="create" groupId={GROUP_ID} onDone={() => {}} onClose={() => {}} />,
      client,
    )
    // No skeleton while it loads.
    expect(screen.getByRole('textbox', { name: 'Amount' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: `${t('expenses.fields.currency')}, USD` }),
    ).toBeVisible()
    act(() => client.setQueryData(moneyKeys.lastCurrency(GROUP_ID, ME), 'EUR'))
    expect(
      await screen.findByRole('button', { name: `${t('expenses.fields.currency')}, EUR` }),
    ).toBeVisible()
  })
})

describe('last currency, answered late', () => {
  it('is ignored once something was typed', async () => {
    const client = seededClient((c) =>
      c.removeQueries({ queryKey: moneyKeys.lastCurrency(GROUP_ID, ME) }),
    )
    renderWithClient(
      <ExpenseForm mode="create" groupId={GROUP_ID} onDone={() => {}} onClose={() => {}} />,
      client,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '25' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'What was it?' }), {
      target: { value: 'Snacks' },
    })
    // The remembered currency arrives after the typing (a slow response).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      client.setQueryData(moneyKeys.lastCurrency(GROUP_ID, ME), 'EUR')
    })
    expect(
      screen.getByRole('button', { name: `${t('expenses.fields.currency')}, USD` }),
    ).toBeVisible()
    save()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]![1]).toMatchObject({ amount_cents: 2500, currency: 'USD' })
  })
})

describe('archived groups', () => {
  it('shows a read only notice instead of the form', async () => {
    renderInRouter(
      <ExpenseForm mode="create" groupId={GROUP_ID} onDone={() => {}} onClose={() => {}} />,
      seededClient((c) =>
        c.setQueryData(moneyKeys.groupInfo(GROUP_ID), {
          ...group,
          archived_at: '2026-10-01T00:00:00Z',
        }),
      ),
    )
    expect(await screen.findByText(t('expenses.form.archivedTitle'))).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Amount' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save expense' })).not.toBeInTheDocument()
  })
})

describe('adjustment split', () => {
  it('adds each adjustment on top of an equal split', async () => {
    setup()
    fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('radio', { name: t('splitTypes.adjustment.short') }))
    fireEvent.change(
      screen.getByRole('textbox', { name: t('expenses.adjust.of', { name: 'You' }) }),
      { target: { value: '10' } },
    )
    expect(screen.getByText(t('expenses.adjust.rest', { amount: '$90.00' }))).toBeInTheDocument()
    expect(screen.getByText('$40.00')).toBeInTheDocument()

    // A minus adjustment through the sign toggle.
    fireEvent.click(
      screen.getByRole('button', { name: t('expenses.adjust.minusOf', { name: 'Cleo' }) }),
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: t('expenses.adjust.of', { name: 'Cleo' }) }),
      { target: { value: '5' } },
    )
    save()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]![1]).toMatchObject({
      split_type: 'adjustment',
      splits: [
        { user_id: ME, adjustment_cents: 1000 },
        { user_id: BEN, adjustment_cents: 0 },
        { user_id: CLEO, adjustment_cents: -500 },
      ],
    })
  })

  it('will not save adjustments bigger than the total', async () => {
    setup()
    fireEvent.click(screen.getByRole('radio', { name: t('splitTypes.adjustment.short') }))
    fireEvent.change(
      screen.getByRole('textbox', { name: t('expenses.adjust.of', { name: 'Ben' }) }),
      { target: { value: '100' } },
    )
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t('errors.split.adjustments_exceed_total'),
    )
    expect(create).not.toHaveBeenCalled()
  })
})

describe('refunds', () => {
  it('saves a refund, renames the payer field and cannot repeat', async () => {
    setup()
    expect(screen.getByRole('combobox', { name: t('expenses.fields.recurring') })).toBeVisible()
    fireEvent.click(screen.getByRole('switch', { name: t('expenses.refund.label') }))
    expect(screen.getByRole('button', { name: t('expenses.payers.receivedBy') })).toBeVisible()
    expect(
      screen.queryByRole('combobox', { name: t('expenses.fields.recurring') }),
    ).not.toBeInTheDocument()
    save()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]![1]).toMatchObject({ is_refund: true })
    expect(create.mock.calls[0]![1]).not.toHaveProperty('recurrence')
  })
})

describe('default split and last currency', () => {
  it('starts from the group default split', async () => {
    setup((c) =>
      c.setQueryData(moneyKeys.groupInfo(GROUP_ID), {
        ...group,
        default_split: {
          split_type: 'percent',
          splits: [
            { user_id: ME, weight: 60 },
            { user_id: BEN, weight: 40 },
          ],
        },
      }),
    )
    expect(screen.getByRole('radio', { name: 'Percent' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'You, percent' })).toHaveValue('60')
    expect(screen.getByText(t('expenses.defaultSplit.active'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('expenses.defaultSplit.clear') }))
    await waitFor(() => expect(saveDefault).toHaveBeenCalledWith(expect.anything(), GROUP_ID, null))
  })

  it('saves the split as the default when asked', async () => {
    setup()
    fireEvent.click(screen.getByRole('radio', { name: 'Shares' }))
    fireEvent.click(screen.getByRole('button', { name: 'More shares for You' }))
    fireEvent.click(screen.getByRole('checkbox', { name: t('expenses.defaultSplit.save') }))
    save()
    await waitFor(() => expect(saveDefault).toHaveBeenCalledTimes(1))
    expect(saveDefault.mock.calls[0]![2]).toEqual({
      split_type: 'shares',
      splits: [
        { user_id: ME, weight: 2 },
        { user_id: BEN, weight: 1 },
        { user_id: CLEO, weight: 1 },
      ],
    })
  })

  it('offers no default for an equal split between everyone', () => {
    setup()
    expect(
      screen.queryByRole('checkbox', { name: t('expenses.defaultSplit.save') }),
    ).not.toBeInTheDocument()
  })

  it('starts in the currency last used in the group', () => {
    setup((c) => c.setQueryData(moneyKeys.lastCurrency(GROUP_ID, ME), 'EUR'))
    expect(
      screen.getByRole('button', { name: `${t('expenses.fields.currency')}, EUR` }),
    ).toBeVisible()
  })
})

describe('by item', () => {
  it('reopens the stored items, tax, tip and discount', () => {
    const saved = expense({
      split_type: 'itemized',
      amount_cents: 3300,
      tax_cents: 300,
      tip_cents: null,
      discount_cents: 100,
      expense_items: [
        { position: 0, description: 'Noodles', amount_cents: 1000, user_ids: [ME] },
        { position: 1, description: 'Dumplings', amount_cents: 2100, user_ids: [ME, BEN] },
      ],
    })
    renderWithClient(
      <ExpenseForm mode="edit" expense={saved} onDone={() => {}} onClose={() => {}} />,
    )
    expect(screen.getByRole('radio', { name: 'By item' })).toBeChecked()
    expect(
      screen.getAllByRole('textbox', { name: 'Item' }).map((i) => (i as HTMLInputElement).value),
    ).toEqual(['Noodles', 'Dumplings'])
    expect(screen.getByLabelText('Tax')).toHaveValue('3')
    expect(screen.getByLabelText('Discount')).toHaveValue('1')
    expect(screen.queryByText(t('expenses.form.itemizedEditNote'))).not.toBeInTheDocument()
  })
})

describe('two people', () => {
  it('offers the owed in full shortcuts', async () => {
    setup((c) =>
      c.setQueryData(moneyKeys.groupInfo(GROUP_ID), { ...group, members: members.slice(0, 2) }),
    )
    const quick = screen.getByRole('group', { name: t('expenses.quick.label') })
    expect(
      within(quick).getByRole('button', { name: t('expenses.quick.youPaidEqual') }),
    ).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(
      within(quick).getByRole('button', { name: t('expenses.quick.youOweAll', { name: 'Ben' }) }),
    )
    save()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]![1]).toMatchObject({
      paid_by: BEN,
      split_type: 'equal',
      splits: [{ user_id: ME }],
    })
  })
})
