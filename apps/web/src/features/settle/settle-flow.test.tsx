import { moneyKeys, settleUp } from '@potluck/api'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BEN, CLEO, GROUP_ID, ME, renderWithClient, seededClient } from '../expenses/test-utils'
import { SettleFlow } from './settle-flow'

vi.mock('@/lib/supabase', () => import('../expenses/fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))
vi.mock('@potluck/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@potluck/api')>()),
  settleUp: vi.fn(async () => ({ id: 's1' })),
}))

const pay = vi.mocked(settleUp)

function setup(props: { to?: string; amount?: number } = {}) {
  const client = seededClient((c) => {
    c.setQueryData(moneyKeys.expenses(GROUP_ID), [])
    c.setQueryData(moneyKeys.settlements(GROUP_ID), [])
    c.setQueryData(moneyKeys.simplified(GROUP_ID), [
      { from_user: ME, to_user: BEN, amount_cents: 4750 },
      { from_user: CLEO, to_user: BEN, amount_cents: 1000 },
    ])
  })
  const onPickPerson = vi.fn()
  const onFinish = vi.fn()
  renderWithClient(
    <SettleFlow
      groupId={GROUP_ID}
      onClose={() => {}}
      onPickPerson={onPickPerson}
      onFinish={onFinish}
      {...props}
    />,
    client,
  )
  return { onPickPerson, onFinish }
}

describe('SettleFlow', () => {
  beforeEach(() => pay.mockClear())

  it('suggests the people you owe first, with the amount', () => {
    const { onPickPerson } = setup()
    expect(screen.getByRole('heading', { name: 'Who are you paying?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Ben Okafor/ }))
    expect(onPickPerson).toHaveBeenCalledWith(BEN, 4750)
  })

  it('defaults to what you owe and ticks down to zero once paid', async () => {
    const { onFinish } = setup({ to: BEN })
    expect(screen.getByText('You owe Ben $47.50')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveValue('47.50')

    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'Venmo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))

    await waitFor(() =>
      expect(pay.mock.calls[0]![1]).toEqual({
        groupId: GROUP_ID,
        toUser: BEN,
        amountCents: 4750,
        note: 'Venmo',
      }),
    )
    expect(await screen.findByRole('heading', { name: 'All square with Ben' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('$0.00')).toBeInTheDocument(), { timeout: 3000 })

    fireEvent.click(screen.getByRole('button', { name: 'Back to Hike crew' }))
    expect(onFinish).toHaveBeenCalled()
  })

  it('says what is left after a partial payment', async () => {
    setup({ to: BEN, amount: 2000 })
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(await screen.findByRole('heading', { name: 'Payment recorded' })).toBeInTheDocument()
    expect(screen.getByText('You still owe $27.50')).toBeInTheDocument()
  })
})
