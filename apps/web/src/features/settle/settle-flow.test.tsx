import type * as Api from '@potluck/api'
import {
  moneyKeys,
  paymentKeys,
  recordPayment,
  updateSettlement,
  type Settlement,
} from '@potluck/api'
import { t } from '@potluck/i18n'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { goOffline, goOnline } from '@/test/network'
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
  // Like the server: the payment it recorded.
  recordPayment: vi.fn(async (_c: unknown, input: Api.RecordPaymentInput) => ({
    id: 's1',
    from_user: input.fromUser,
    to_user: input.toUser,
    amount_cents: input.amountCents,
    currency: input.currency ?? 'USD',
  })),
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
  return { onPickPerson, onFinish, client }
}

describe('SettleFlow', () => {
  beforeEach(() => {
    pay.mockClear()
    update.mockClear()
  })
  afterEach(() => goOnline())

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
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      }),
    )
    expect(await screen.findByRole('heading', { name: 'All square with Ben' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('$0.00')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Back to Hike crew' }))
    expect(onFinish).toHaveBeenCalled()
  })

  it('holds a payment while offline and records it once back', async () => {
    setup({ to: BEN })
    act(() => goOffline())
    const record = screen.getByRole('button', { name: 'Record payment' })
    expect(record).toBeDisabled()
    expect(screen.getByText(t('app.offline.form'))).toBeInTheDocument()

    act(() => goOnline())
    fireEvent.click(record)
    await waitFor(() => expect(pay).toHaveBeenCalledTimes(1))
    expect(pay.mock.calls[0]![1]).toMatchObject({ toUser: BEN, amountCents: 4750 })
  })

  it('keeps the payment when the connection drops while recording, and Try again records it once', async () => {
    const { client } = setup({ to: BEN })
    client.setQueryData(moneyKeys.recurring(GROUP_ID), [])
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'Venmo' } })
    pay.mockRejectedValueOnce({ message: 'TypeError: Failed to fetch', code: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))

    expect(await screen.findByText(t('app.offline.failed'))).toBeInTheDocument()
    // The payment may have landed anyway, so the group's money is fetched again.
    expect(client.getQueryState(moneyKeys.recurring(GROUP_ID))?.isInvalidated).toBe(true)
    expect(pay).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveValue('47.50')
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Venmo')

    // One action: Record payment itself turns into Try again.
    expect(screen.getAllByRole('button', { name: t('common.retry') })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('heading', { name: 'All square with Ben' })).toBeInTheDocument()
    expect(pay).toHaveBeenCalledTimes(2)
    expect(pay.mock.calls[1]![1]).toMatchObject({ toUser: BEN, amountCents: 4750, note: 'Venmo' })
    // The same request id both times, so a payment that did land is not recorded twice.
    const key = (pay.mock.calls[0]![1] as { requestId?: string }).requestId
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect((pay.mock.calls[1]![1] as { requestId?: string }).requestId).toBe(key)
  })

  it('holds the payment after a lost reply and shows the one the server recorded', async () => {
    setup({ to: BEN })
    pay.mockRejectedValueOnce({ message: 'TypeError: Failed to fetch', code: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(await screen.findByText(t('app.offline.failed'))).toBeInTheDocument()

    // A retry sends the same request id, so it can only ever repeat what was sent.
    expect(screen.getByRole('textbox', { name: 'Amount' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeDisabled()
    expect(screen.getByRole('button', { name: t('settle.swap') })).toBeDisabled()

    // The server hands back an earlier $20 payment under that id: that is what was recorded.
    pay.mockResolvedValueOnce({
      id: 's0',
      from_user: ME,
      to_user: BEN,
      amount_cents: 2000,
      currency: 'USD',
    } as Awaited<ReturnType<typeof recordPayment>>)
    fireEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('heading', { name: 'Payment recorded' })).toBeInTheDocument()
    expect(within(screen.getByRole('status')).getByText('You still owe $27.50')).toBeInTheDocument()
  })

  it('works out what is left from the debt before the payment, even once the debts count it', async () => {
    const { client } = setup({ to: BEN, amount: 3000 })
    pay.mockRejectedValueOnce({ message: 'TypeError: Failed to fetch', code: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(await screen.findByText(t('app.offline.failed'))).toBeInTheDocument()

    // The lost try had landed: the debts come back with the $30 already off the $47.50.
    act(() =>
      client.setQueryData(moneyKeys.simplified(GROUP_ID), [
        { from_user: ME, to_user: BEN, amount_cents: 1750 },
        { from_user: CLEO, to_user: ME, amount_cents: 1000 },
      ]),
    )
    expect(await screen.findByText('You owe Ben $17.50')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('heading', { name: 'Payment recorded' })).toBeInTheDocument()
    expect(within(screen.getByRole('status')).getByText('You still owe $17.50')).toBeInTheDocument()
  })

  it('keeps a refused payment a refusal after the connection goes', async () => {
    setup({ to: BEN })
    pay.mockRejectedValueOnce({ message: 'member_not_in_group', code: '23514' })
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    await waitFor(() => expect(pay).toHaveBeenCalledTimes(1))

    act(() => goOffline())
    expect(screen.getByText(t('app.offline.form'))).toBeInTheDocument()
    expect(screen.queryByText(t('app.offline.failed'))).toBeNull()
    expect(screen.queryByRole('button', { name: t('common.retry') })).toBeNull()
  })

  it('says what is left after a partial payment', async () => {
    setup({ to: BEN, amount: 2000 })
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(await screen.findByRole('heading', { name: 'Payment recorded' })).toBeInTheDocument()
    // The headline is what was just paid; what is left sits underneath in plain type.
    const status = screen.getByRole('status')
    expect(within(status).getByText('$20.00')).toBeInTheDocument()
    expect(within(status).queryByText('$27.50')).not.toBeInTheDocument()
    expect(within(status).getByText('You still owe $27.50')).toBeInTheDocument()
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
