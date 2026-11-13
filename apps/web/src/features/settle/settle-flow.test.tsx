import type * as Api from '@potluck/api'
import {
  moneyKeys,
  paymentKeys,
  recordPayment,
  updateSettlement,
  type Settlement,
} from '@potluck/api'
import { t } from '@potluck/i18n'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BEN,
  CLEO,
  GROUP_ID,
  ME,
  group,
  renderWithClient,
  seededClient,
} from '../expenses/test-utils'
import { SettleFlow, PaymentForm, type PickPerson } from './settle-flow'

vi.mock('@/lib/supabase', () => import('../expenses/fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))
vi.mock('@potluck/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  recordPayment: vi.fn(async () => ({ id: 's1' })),
  updateSettlement: vi.fn(async () => ({ id: 's1' })),
}))

const pay = vi.mocked(recordPayment)
const update = vi.mocked(updateSettlement)

function setup(props: { from?: string; to?: string; amount?: number; role?: 'admin' } = {}) {
  const client = seededClient((c) => {
    c.setQueryData(moneyKeys.expenses(GROUP_ID), [])
    c.setQueryData(moneyKeys.settlements(GROUP_ID), [])
    c.setQueryData(moneyKeys.simplified(GROUP_ID), [
      { from_user: ME, to_user: BEN, amount_cents: 4750 },
      { from_user: CLEO, to_user: ME, amount_cents: 1000 },
    ])
    c.setQueryData(paymentKeys.methods(BEN), [])
    c.setQueryData(paymentKeys.methods(ME), [])
    if (props.role) {
      c.setQueryData(moneyKeys.groupInfo(GROUP_ID), {
        ...group,
        members: group.members.map((m) => (m.id === ME ? { ...m, role: props.role } : m)),
      })
    }
  })
  const onPickPerson = vi.fn<(pick: PickPerson | undefined) => void>()
  const onFinish = vi.fn()
  renderWithClient(
    <SettleFlow
      groupId={GROUP_ID}
      onClose={() => {}}
      onPickPerson={onPickPerson}
      onFinish={onFinish}
      from={props.from}
      to={props.to}
      amount={props.amount}
    />,
    client,
  )
  return { onPickPerson, onFinish }
}

describe('SettleFlow', () => {
  beforeEach(() => {
    pay.mockClear()
    update.mockClear()
  })

  it('lists who you owe and who owes you, with the amounts', () => {
    const { onPickPerson } = setup()
    expect(screen.getByRole('heading', { name: t('settle.pickPerson') })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Ben Okafor/ }))
    expect(onPickPerson).toHaveBeenCalledWith({ to: BEN, amount: 4750 })
    fireEvent.click(screen.getByRole('button', { name: /Cleo Park/ }))
    expect(onPickPerson).toHaveBeenLastCalledWith({ from: CLEO, amount: 1000 })
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
        fromUser: ME,
        toUser: BEN,
        amountCents: 4750,
        currency: undefined,
        note: 'Venmo',
        settledOn: null,
      }),
    )
    expect(await screen.findByRole('heading', { name: 'All square with Ben' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('$0.00')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Back to Hike crew' }))
    expect(onFinish).toHaveBeenCalled()
  })

  it('says what is left after a partial payment', async () => {
    setup({ to: BEN, amount: 2000 })
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(await screen.findByRole('heading', { name: 'Payment recorded' })).toBeInTheDocument()
    expect(screen.getByText('You still owe $27.50')).toBeInTheDocument()
  })

  it('records "Cleo paid me" on a past day', async () => {
    setup({ from: CLEO })
    expect(screen.getByRole('heading', { name: 'Cleo paid you' })).toBeInTheDocument()
    expect(screen.getByText('Cleo owes you $10.00')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(t('settle.date')), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    await waitFor(() =>
      expect(pay.mock.calls[0]![1]).toMatchObject({
        fromUser: CLEO,
        toUser: ME,
        amountCents: 1000,
        settledOn: '2026-10-01',
      }),
    )
    expect(await screen.findByRole('heading', { name: 'All square with Cleo' })).toBeInTheDocument()
  })

  it('swaps who paid, picking up the other direction', () => {
    setup({ to: CLEO })
    expect(screen.getByRole('heading', { name: 'Paying Cleo' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('settle.swap') }))
    expect(screen.getByRole('heading', { name: 'Cleo paid you' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveValue('10')
  })

  it('stops a member recording a payment between two others, but not an admin', async () => {
    setup({ from: BEN, to: CLEO, amount: 500 })
    expect(screen.getByRole('alert')).toHaveTextContent(t('expenses.errors.not_a_party'))
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(pay).not.toHaveBeenCalled()
  })

  it('lets an admin record a payment between two others', async () => {
    setup({ from: BEN, to: CLEO, amount: 500, role: 'admin' })
    expect(screen.getByRole('heading', { name: 'Ben paid Cleo' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    await waitFor(() =>
      expect(pay.mock.calls[0]![1]).toMatchObject({ fromUser: BEN, toUser: CLEO }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Ben and Cleo are square' }),
    ).toBeInTheDocument()
  })

  it('asks for an amount', () => {
    setup({ to: CLEO })
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(screen.getByText(t('settle.amountRequired'))).toBeInTheDocument()
    expect(pay).not.toHaveBeenCalled()
  })
})

describe('PaymentForm editing', () => {
  beforeEach(() => update.mockClear())

  const saved: Settlement = {
    id: 's1',
    group_id: GROUP_ID,
    from_user: ME,
    to_user: BEN,
    amount_cents: 2000,
    currency: 'USD',
    fx_rate: '1.000000000000',
    note: 'cash',
    settled_at: '2026-11-04T18:00:00Z',
    created_at: '2026-11-04T18:00:00Z',
    created_by: ME,
    deleted_at: null,
  }

  it('sends only what changed', async () => {
    const onDone = vi.fn()
    renderWithClient(
      <PaymentForm
        group={group}
        debts={[]}
        initialFrom={saved.from_user}
        initialTo={saved.to_user}
        initialAmount={saved.amount_cents}
        editing={saved}
        onClose={() => {}}
        onDone={onDone}
      />,
      seededClient((c) => c.setQueryData(paymentKeys.methods(BEN), [])),
    )
    expect(screen.getByRole('heading', { name: t('settle.editTitle') })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: t('settle.saveChanges') }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(expect.anything(), 's1', { note: null }),
    )
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('keeps people and amount fixed when someone has left', () => {
    renderWithClient(
      <PaymentForm
        group={{ ...group, members: group.members.filter((m) => m.id !== BEN) }}
        debts={[]}
        initialFrom={saved.from_user}
        initialTo={saved.to_user}
        initialAmount={saved.amount_cents}
        editing={saved}
        onClose={() => {}}
        onDone={() => {}}
      />,
    )
    expect(screen.getByRole('note')).toHaveTextContent(t('settle.detail.departedLocked'))
    expect(screen.queryByRole('textbox', { name: 'Amount' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('settle.swap') })).not.toBeInTheDocument()
    const paidBy = screen.getByRole('combobox', { name: t('settle.paidBy') })
    expect(paidBy).toBeDisabled()
    expect(within(paidBy).getByText('You')).toBeInTheDocument()
  })
})
