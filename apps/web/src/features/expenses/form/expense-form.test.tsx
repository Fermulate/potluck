import type * as Api from '@potluck/api'
import { createExpense } from '@potluck/api'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BEN, CLEO, GROUP_ID, ME, renderWithClient } from '../test-utils'
import { ExpenseForm } from './expense-form'

vi.mock('@/lib/supabase', () => import('../fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))
vi.mock('@potluck/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  createExpense: vi.fn(async () => ({ id: 'new-expense' })),
}))

const create = vi.mocked(createExpense)

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

  it('snaps a dragged handle to whole percents and keeps the total at 100%', async () => {
    setup()
    fireEvent.click(screen.getByRole('radio', { name: 'Percentages' }))
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
    fireEvent.click(screen.getByRole('radio', { name: 'Percentages' }))
    fireEvent.change(percentOf('You'), { target: { value: '50' } })
    fireEvent.blur(percentOf('You'))
    expect(percentOf('Ben').value).toBe('25')
    expect(percentOf('Cleo').value).toBe('25')
  })

  it('does not save exact amounts that do not add up', async () => {
    setup()
    fireEvent.click(screen.getByRole('radio', { name: 'Exact amounts' }))
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
})
