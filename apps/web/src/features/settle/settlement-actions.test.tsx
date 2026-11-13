import type * as Api from '@potluck/api'
import { deleteSettlement, moneyKeys, restoreSettlement, type Settlement } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderInRouter } from '../expenses/router-test-utils'
import { BEN, CLEO, GROUP_ID, ME, renderWithClient, seededClient } from '../expenses/test-utils'
import { SettlementActions } from './settlement-actions'

vi.mock('@/lib/supabase', () => import('@/features/expenses/fake-supabase'))
vi.mock('@potluck/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  deleteSettlement: vi.fn(async () => ({})),
  restoreSettlement: vi.fn(async () => ({})),
}))

const remove = vi.mocked(deleteSettlement)
const restore = vi.mocked(restoreSettlement)

function payment(patch: Partial<Settlement> = {}): Settlement {
  return {
    id: 's1',
    group_id: GROUP_ID,
    from_user: BEN,
    to_user: CLEO,
    amount_cents: 2000,
    currency: 'USD',
    fx_rate: '1.000000000000',
    note: null,
    settled_at: '2026-11-04T18:00:00Z',
    created_at: '2026-11-04T18:00:00Z',
    created_by: BEN,
    deleted_at: null,
    ...patch,
  }
}

function setup(settlement: Settlement, role: 'owner' | 'admin' | 'member') {
  const client = seededClient((c) => c.setQueryData(moneyKeys.settlements(GROUP_ID), [settlement]))
  renderInRouter(
    <>
      <SettlementActions
        settlement={settlement}
        viewerId={ME}
        viewerRole={role}
        label="Ben paid Cleo $20.00"
      />
      <Toaster label="Notifications" />
    </>,
    client,
  )
  return client
}

const menuButton = () => screen.findByRole('button', { name: 'Options for Ben paid Cleo $20.00' })

describe('SettlementActions', () => {
  beforeEach(() => remove.mockClear())

  it('is hidden from a member who had nothing to do with the payment', () => {
    renderWithClient(
      <SettlementActions settlement={payment()} viewerId={ME} viewerRole="member" label="x" />,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('is there for the people in the payment and for admins', async () => {
    setup(payment({ to_user: ME }), 'member')
    expect(await menuButton()).toBeInTheDocument()
  })

  it('deletes the payment after asking, and takes it off the list', async () => {
    const client = setup(payment(), 'admin')
    fireEvent.click(await menuButton())
    fireEvent.click(await screen.findByRole('button', { name: t('settle.delete') }))
    const dialog = await screen.findByRole('dialog', { name: t('settle.delete') })
    expect(within(dialog).getByText(t('settle.deleteConfirm'))).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: t('settle.delete') }))

    await waitFor(() => expect(remove).toHaveBeenCalledWith(expect.anything(), 's1'))
    expect(await screen.findByText(t('settle.deleted'))).toBeInTheDocument()
    expect(client.getQueryData(moneyKeys.settlements(GROUP_ID))).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: t('settle.undo') }))
    await waitFor(() => expect(restore).toHaveBeenCalledWith(expect.anything(), 's1'))
    expect(await screen.findByText(t('settle.restored'))).toBeInTheDocument()
  })

  it('offers Edit, which opens the payment form', async () => {
    setup(payment({ from_user: ME }), 'member')
    fireEvent.click(await menuButton())
    expect(await screen.findByRole('link', { name: t('settle.edit') })).toHaveAttribute(
      'href',
      '/payments/s1/edit',
    )
  })

  it('puts the deleted payment back when the server refuses', async () => {
    remove.mockRejectedValueOnce({ message: 'member_not_in_group' })
    const client = setup(payment(), 'owner')
    fireEvent.click(await menuButton())
    fireEvent.click(await screen.findByRole('button', { name: t('settle.delete') }))
    const dialog = await screen.findByRole('dialog', { name: t('settle.delete') })
    fireEvent.click(within(dialog).getByRole('button', { name: t('settle.delete') }))
    expect(await screen.findByText(t('expenses.errors.member_not_in_group'))).toBeInTheDocument()
    expect(client.getQueryData<Settlement[]>(moneyKeys.settlements(GROUP_ID))).toHaveLength(1)
  })
})
