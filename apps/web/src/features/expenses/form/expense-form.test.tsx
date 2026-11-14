import type * as Api from '@potluck/api'
import { createExpense, moneyKeys, updateExpense } from '@potluck/api'
import { t } from '@potluck/i18n'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { goOffline, goOnline } from '@/test/network'
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
      payers: [{ user_id: ME, paid_cents: 9000 }],
      is_refund: false,
      split_type: 'equal',
      splits: [{ user_id: ME }, { user_id: BEN }, { user_id: CLEO }],
      category: 'food',
      notes: null,
      spent_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      receipt_path: null,
    })
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('new-expense'))
  })

  it('offers adding someone new only to people the group lets add people', () => {
    const addButton = () =>
      screen.queryByRole('button', { name: t('people.placeholder.addToSplit') })
    const { unmount } = renderWithClient(
      <ExpenseForm mode="create" groupId={GROUP_ID} onDone={() => {}} onClose={() => {}} />,
    )
    expect(addButton()).toBeInTheDocument()
    unmount()

    renderWithClient(
      <ExpenseForm mode="create" groupId={GROUP_ID} onDone={() => {}} onClose={() => {}} />,
      seededClient((client) =>
        client.setQueryData(moneyKeys.groupInfo(GROUP_ID), { ...group, members_can_invite: false }),
      ),
    )
    expect(screen.getByRole('textbox', { name: 'Amount' })).toBeInTheDocument()
    expect(addButton()).toBeNull()
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
    expect(screen.getByText('Everything adds up')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]![1].splits).toEqual([
      { user_id: ME, weight: 38 },
      { user_id: BEN, weight: 28.67 },
      { user_id: CLEO, weight: 33.33 },
    ])
  })

  // Like a person at a keyboard: one change per keystroke, then on to the next field.
  const typeKeys = (input: HTMLInputElement, text: string) => {
    fireEvent.focus(input)
    for (let i = 1; i <= text.length; i++) {
      fireEvent.change(input, { target: { value: text.slice(0, i) } })
    }
    fireEvent.blur(input)
  }

  it('keeps typed percents exactly as typed and saves them', async () => {
    setup()
    fireEvent.click(screen.getByRole('radio', { name: 'Percent' }))
    typeKeys(percentOf('You'), '50')
    expect(percentOf('Ben').value).toBe('33.33')
    expect(percentOf('Cleo').value).toBe('33.33')
    expect(screen.getByText('16.66% too much')).toBeInTheDocument()
    typeKeys(percentOf('Ben'), '30')
    expect(screen.getByText('13.33% too much')).toBeInTheDocument()
    typeKeys(percentOf('Cleo'), '20')

    expect([percentOf('You').value, percentOf('Ben').value, percentOf('Cleo').value]).toEqual([
      '50',
      '30',
      '20',
    ])
    expect(screen.getByText('Everything adds up')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]![1].splits).toEqual([
      { user_id: ME, weight: 50 },
      { user_id: BEN, weight: 30 },
      { user_id: CLEO, weight: 20 },
    ])
  })

  it('keeps every field when they are filled fast, without a blur in between', async () => {
    setup()
    fireEvent.click(screen.getByRole('radio', { name: 'Percent' }))
    // A whole value per change and no blur, the way autofill or a test runner fills fields.
    fireEvent.change(percentOf('You'), { target: { value: '50' } })
    fireEvent.change(percentOf('Ben'), { target: { value: '30' } })
    fireEvent.change(percentOf('Cleo'), { target: { value: '20' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]![1].splits).toEqual([
      { user_id: ME, weight: 50 },
      { user_id: BEN, weight: 30 },
      { user_id: CLEO, weight: 20 },
    ])
  })

  it('does not save percents that do not add up to 100%', async () => {
    setup()
    fireEvent.click(screen.getByRole('radio', { name: 'Percent' }))
    typeKeys(percentOf('You'), '50')
    typeKeys(percentOf('Ben'), '30')
    typeKeys(percentOf('Cleo'), '10')
    expect(screen.getByText('10% left to assign')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Percentages need to add up to 100%.',
    )
    expect(create).not.toHaveBeenCalled()
    // Typed values are left alone by a failed save.
    expect(percentOf('Cleo').value).toBe('10')
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
    // The bill is stored as entered, so editing reopens it.
    expect(payload.items).toEqual([
      { description: 'Dumplings', amount_cents: 3000, user_ids: [ME, BEN] },
    ])
    expect(payload).toMatchObject({ tax_cents: null, tip_cents: 600, discount_cents: null })
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
          { user_id: ME, share_cents: 6000, weight: null, adjustment_cents: null },
          { user_id: GONE, share_cents: 3000, weight: null, adjustment_cents: null },
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
      })
    })

    it('locks the payer too when the payer left', async () => {
      const saved = expense({
        description: 'Fuel',
        paid_by: GONE,
        expense_splits: [
          { user_id: ME, share_cents: 1500, weight: null, adjustment_cents: null },
          { user_id: BEN, share_cents: 1500, weight: null, adjustment_cents: null },
        ],
      })
      const { onDone } = edit(saved)
      expect(screen.getByRole('button', { name: 'Paid by' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Paid by' })).toHaveTextContent('Dana')
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(onDone).toHaveBeenCalled())
      expect(update.mock.calls[0]![2]).not.toHaveProperty('paid_by')
      expect(update.mock.calls[0]![2]).not.toHaveProperty('amount_cents')
    })

    it('leaves everything editable when nobody who left has money on it', async () => {
      const saved = expense({
        expense_splits: [
          { user_id: ME, share_cents: 1500, weight: null, adjustment_cents: null },
          { user_id: BEN, share_cents: 1500, weight: null, adjustment_cents: null },
        ],
      })
      edit(saved)
      expect(screen.getByRole('textbox', { name: 'Amount' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Paid by' })).not.toBeDisabled()
      expect(screen.queryByText(/has left the group/)).not.toBeInTheDocument()
    })
  })

  describe('category', () => {
    const transport = () => screen.getByRole('radio', { name: /Transport/ })
    const describeAs = (text: string) =>
      fireEvent.change(screen.getByRole('textbox', { name: 'What was it?' }), {
        target: { value: text },
      })

    it('follows the description until someone picks one: Uber is a taxi, under Transport', async () => {
      setup()
      describeAs('Uber to the airport')
      expect(transport()).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByText('Suggested')).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: /Taxi/ })).toHaveAttribute('aria-checked', 'true')

      describeAs('Groceries')
      expect(transport()).toHaveAttribute('aria-checked', 'false')
      expect(screen.getByRole('radio', { name: /Groceries/ })).toHaveAttribute(
        'aria-checked',
        'true',
      )

      describeAs('Uber')
      fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
      expect(create.mock.calls[0]![1]).toMatchObject({ category: 'taxi' })
    })

    it('stops following once a category is picked, and keeps subcategories in reach', async () => {
      setup()
      fireEvent.click(transport())
      fireEvent.click(screen.getByRole('radio', { name: /Parking/ }))
      describeAs('Pizza')
      await waitFor(() => expect(screen.queryByText('Suggested')).not.toBeInTheDocument())
      expect(screen.getByRole('radio', { name: /Parking/ })).toHaveAttribute('aria-checked', 'true')

      // The parent again goes back from the subcategory to the category, then clears it.
      fireEvent.click(transport())
      expect(screen.getByRole('radio', { name: /Parking/ })).toHaveAttribute(
        'aria-checked',
        'false',
      )
      fireEvent.click(transport())
      expect(transport()).toHaveAttribute('aria-checked', 'false')
      await waitFor(() =>
        expect(screen.queryByRole('radio', { name: /Parking/ })).not.toBeInTheDocument(),
      )

      fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
      expect(create.mock.calls[0]![1]).toMatchObject({ category: null })
    })

    it('starts a home bill as a monthly repeating expense', async () => {
      renderWithClient(
        <ExpenseForm
          mode="create"
          groupId={GROUP_ID}
          preset="rent"
          onDone={() => {}}
          onClose={() => {}}
        />,
      )
      expect(await screen.findByRole('textbox', { name: 'What was it?' })).toHaveValue('Rent')
      expect(screen.getByRole('radio', { name: /Rent/ })).toHaveAttribute('aria-checked', 'true')
      fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), {
        target: { value: '1500' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
      expect(create.mock.calls[0]![1]).toMatchObject({ category: 'rent', recurrence: 'monthly' })
    })
  })
})

describe('ExpenseForm offline', () => {
  beforeEach(() => create.mockClear())
  afterEach(() => goOnline())
  const saveButton = () => screen.getByRole('button', { name: 'Save expense' })

  it('keeps the entry and holds the save until the connection is back', async () => {
    const { onDone } = setup()
    act(() => goOffline())

    expect(screen.getByText(t('app.offline.form'))).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    // Enter in a field does not sneak a save through either.
    fireEvent.submit(document.querySelector('form')!)
    expect(create).not.toHaveBeenCalled()
    // Closing the tab now would lose what was typed, so the browser asks first.
    const leave = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leave)
    expect(leave.defaultPrevented).toBe(true)

    act(() => goOnline())
    expect(screen.queryByText(t('app.offline.form'))).toBeNull()
    expect(screen.getByRole('textbox', { name: 'What was it?' })).toHaveValue('Cabin deposit')
    fireEvent.click(saveButton())
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]![1]).toMatchObject({
      description: 'Cabin deposit',
      amount_cents: 9000,
    })
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('new-expense'))
  })

  it('keeps the entry when the connection drops during a save, and Try again saves it once', async () => {
    const { onDone } = setup()
    // What supabase-js hands back when fetch never got an answer.
    create.mockRejectedValueOnce({ message: 'TypeError: Failed to fetch', code: '' })
    fireEvent.click(saveButton())

    expect(await screen.findByText(t('app.offline.failed'))).toBeInTheDocument()
    expect(create).toHaveBeenCalledTimes(1)
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'What was it?' })).toHaveValue('Cabin deposit')
    const leave = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leave)
    expect(leave.defaultPrevented).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('new-expense'))
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1]![1]).toEqual(create.mock.calls[0]![1])
    expect(create.mock.calls[1]![1]).toMatchObject({
      description: 'Cabin deposit',
      amount_cents: 9000,
    })
    expect(screen.queryByText(t('app.offline.failed'))).toBeNull()
  })

  it('still reports a refused save as an error, not as the connection', async () => {
    setup()
    create.mockRejectedValueOnce({ message: 'payers_sum_mismatch', code: '23514' })
    fireEvent.click(saveButton())
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(t('app.offline.failed'))).toBeNull()
    expect(screen.queryByRole('button', { name: t('common.retry') })).toBeNull()
  })
})
