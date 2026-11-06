import type * as Api from '@potluck/api'
import { createExpense, moneyKeys, updateExpense } from '@potluck/api'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BEN,
  CLEO,
  GROUP_ID,
  ME,
  expense,
  members,
  renderWithClient,
  seededClient,
} from '../test-utils'
import { ExpenseForm } from './expense-form'

vi.mock('@/lib/supabase', () => import('../fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))
vi.mock('@potluck/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  createExpense: vi.fn(async () => ({ id: 'new-expense' })),
  // Like the server: a rewritten split may only name current members.
  updateExpense: vi.fn(async (_client: unknown, id: string, payload: Api.ExpenseUpdate) => {
    const current = new Set(members.map((m) => m.id))
    if (payload.splits?.some((s) => !current.has(s.user_id))) {
      throw { message: 'split_member_not_in_group', code: '23514' }
    }
    return { id }
  }),
}))

const create = vi.mocked(createExpense)
const update = vi.mocked(updateExpense)

function setup() {
  const onDone = vi.fn()
  renderWithClient(
    <ExpenseForm mode="create" groupId={GROUP_ID} onDone={onDone} onClose={() => {}} />,
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '90' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'What was it?' }), {
    target: { value: 'Cabin deposit' },
  })
  return { onDone }
}

const percentOf = (name: string) =>
  screen.getByRole('textbox', { name: `${name}, percent` }) as HTMLInputElement

describe('ExpenseForm', () => {
  beforeEach(() => create.mockClear())

  it('saves an equal split as people only and lets the server do the cents', async () => {
    const { onDone } = setup()
    fireEvent.click(screen.getByRole('radio', { name: /Food/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]![1]).toEqual({
      group_id: GROUP_ID,
      description: 'Cabin deposit',
      amount_cents: 9000,
      currency: 'USD',
      paid_by: ME,
      split_type: 'equal',
      splits: [{ user_id: ME }, { user_id: BEN }, { user_id: CLEO }],
      category: 'food',
      notes: null,
      spent_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      receipt_path: null,
    })
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('new-expense'))
  })

  it('says who gets the extra cent when a split does not divide evenly', () => {
    setup()
    expect(screen.queryByText(/so it adds up/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '100' } })
    expect(screen.getByText('$0.01 extra for you so it adds up.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /How rounding works/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/expenses/splits/#how-rounding-works'),
    )

    fireEvent.click(screen.getByRole('radio', { name: 'Exact' }))
    expect(screen.queryByText(/so it adds up/)).not.toBeInTheDocument()
  })

  it('snaps a dragged handle to whole percents and keeps the total at 100%', async () => {
    setup()
    fireEvent.click(screen.getByRole('radio', { name: 'Percent' }))
    const [first] = screen.getAllByRole('slider')
    for (let i = 0; i < 5; i++) fireEvent.keyDown(first!, { key: 'ArrowRight' })

    expect(percentOf('You').value).toBe('38')
    expect(percentOf('Ben').value).toBe('28.67')
    expect(percentOf('Cleo').value).toBe('33.33')
    expect(screen.getByText('100% / 100%')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]![1].splits).toEqual([
      { user_id: ME, weight: 38 },
      { user_id: BEN, weight: 28.67 },
      { user_id: CLEO, weight: 33.33 },
    ])
  })

  it('rebalances everyone else when a percent is typed', () => {
    setup()
    fireEvent.click(screen.getByRole('radio', { name: 'Percent' }))
    fireEvent.change(percentOf('You'), { target: { value: '50' } })
    fireEvent.blur(percentOf('You'))
    expect(percentOf('Ben').value).toBe('25')
    expect(percentOf('Cleo').value).toBe('25')
  })

  it('does not save exact amounts that do not add up', async () => {
    setup()
    fireEvent.click(screen.getByRole('radio', { name: 'Exact' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'You, amount' }), {
      target: { value: '50' },
    })
    expect(screen.getByText('$40.00 left to assign')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The amounts need to add up to the total.',
    )
    expect(create).not.toHaveBeenCalled()

    fireEvent.change(screen.getByRole('textbox', { name: 'Ben, amount' }), {
      target: { value: '40' },
    })
    expect(screen.getByText('Everything adds up')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]![1].splits).toEqual([
      { user_id: ME, share_cents: 5000 },
      { user_id: BEN, share_cents: 4000 },
    ])
  })

  it('uses the items total for an itemized bill', async () => {
    setup()
    fireEvent.click(screen.getByRole('radio', { name: 'By item' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Item' }), {
      target: { value: 'Dumplings' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Price, Dumplings' }), {
      target: { value: '30' },
    })
    const assign = screen.getByRole('group', { name: 'Who had Dumplings?' })
    fireEvent.click(within(assign).getByRole('button', { name: /Cleo/ }))
    fireEvent.change(screen.getByLabelText('Tip'), { target: { value: '6' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const payload = create.mock.calls[0]![1]
    expect(payload.amount_cents).toBe(3600)
    expect(payload.split_type).toBe('itemized')
    expect(payload.splits).toEqual([
      { user_id: ME, share_cents: 1800 },
      { user_id: BEN, share_cents: 1800 },
    ])
  })

  it('fills the tip from a percent of the subtotal', async () => {
    setup()
    fireEvent.click(screen.getByRole('radio', { name: 'By item' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Item' }), {
      target: { value: 'Dinner' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Price, Dinner' }), {
      target: { value: '80' },
    })
    const twenty = screen.getByRole('button', { name: 'Tip 20% of the subtotal' })
    fireEvent.click(twenty)
    expect(twenty).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Tip')).toHaveValue('16')

    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]![1].amount_cents).toBe(9600)
  })

  it('follows the subtotal after a percent is picked, until a tip is typed', () => {
    setup()
    fireEvent.click(screen.getByRole('radio', { name: 'By item' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Item' }), {
      target: { value: 'Dinner' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Price, Dinner' }), {
      target: { value: '80' },
    })
    const eighteen = screen.getByRole('button', { name: 'Tip 18% of the subtotal' })
    fireEvent.click(eighteen)
    expect(screen.getByLabelText('Tip')).toHaveValue('14.40')

    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    const [, dessert] = screen.getAllByRole('textbox', { name: 'Item' })
    fireEvent.change(dessert!, { target: { value: 'Dessert' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Price, Dessert' }), {
      target: { value: '20' },
    })
    expect(eighteen).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Tip')).toHaveValue('18')

    fireEvent.change(screen.getByLabelText('Tip'), { target: { value: '15' } })
    expect(eighteen).toHaveAttribute('aria-pressed', 'false')
    fireEvent.change(screen.getByRole('textbox', { name: 'Price, Dessert' }), {
      target: { value: '40' },
    })
    expect(screen.getByLabelText('Tip')).toHaveValue('15')
  })

  describe('editing an expense with someone who left the group', () => {
    const GONE = 'dddddddd-0000-4000-8000-000000000004'

    function edit(saved: Api.ExpenseWithSplits) {
      const onDone = vi.fn()
      const client = seededClient((c) =>
        c.setQueryData(moneyKeys.people(), [
          ...members,
          { id: GONE, display_name: 'Dana Gone', avatar_path: null, deleted_at: null },
        ]),
      )
      renderWithClient(
        <ExpenseForm mode="edit" expense={saved} onDone={onDone} onClose={() => {}} />,
        client,
      )
      return { onDone }
    }

    beforeEach(() => {
      update.mockClear()
    })

    it('locks the money when they have a share, and saves only the details', async () => {
      const saved = expense({
        description: 'Cabin',
        amount_cents: 9000,
        split_type: 'exact',
        expense_splits: [
          { user_id: ME, share_cents: 6000, weight: null },
          { user_id: GONE, share_cents: 3000, weight: null },
        ],
      })
      const { onDone } = edit(saved)
      expect(
        screen.getByText(
          "Someone in this expense has left the group, so the amounts can't change.",
        ),
      ).toBeInTheDocument()
      const split = screen.getByRole('list', { name: 'Split between' })
      expect(within(split).getByText('Dana Gone')).toBeInTheDocument()
      expect(within(split).getByText('$30.00')).toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: 'Amount' })).not.toBeInTheDocument()
      expect(screen.queryByRole('radio', { name: 'Exact' })).not.toBeInTheDocument()

      fireEvent.change(screen.getByRole('textbox', { name: 'What was it?' }), {
        target: { value: 'Cabin deposit' },
      })
      fireEvent.click(screen.getByRole('radio', { name: /Lodging/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      await waitFor(() => expect(onDone).toHaveBeenCalledWith(saved.id))
      expect(update.mock.calls[0]![2]).toEqual({
        description: 'Cabin deposit',
        category: 'lodging',
        notes: null,
        spent_at: saved.spent_at,
        receipt_path: null,
      })
    })

    it('locks the payer too when the payer left', async () => {
      const saved = expense({
        description: 'Fuel',
        paid_by: GONE,
        expense_splits: [
          { user_id: ME, share_cents: 1500, weight: null },
          { user_id: BEN, share_cents: 1500, weight: null },
        ],
      })
      const { onDone } = edit(saved)
      expect(screen.getByRole('combobox', { name: 'Paid by' })).toBeDisabled()
      expect(screen.getByRole('combobox', { name: 'Paid by' })).toHaveTextContent('Dana Gone')
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(onDone).toHaveBeenCalled())
      expect(update.mock.calls[0]![2]).not.toHaveProperty('paid_by')
      expect(update.mock.calls[0]![2]).not.toHaveProperty('amount_cents')
    })

    it('leaves everything editable when nobody who left has money on it', async () => {
      const saved = expense({
        expense_splits: [
          { user_id: ME, share_cents: 1500, weight: null },
          { user_id: BEN, share_cents: 1500, weight: null },
        ],
      })
      edit(saved)
      expect(screen.getByRole('textbox', { name: 'Amount' })).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Paid by' })).not.toBeDisabled()
      expect(screen.queryByText(/has left the group/)).not.toBeInTheDocument()
    })
  })
})
