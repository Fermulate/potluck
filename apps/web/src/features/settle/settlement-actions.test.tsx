import type * as Api from '@potluck/api'
import { deleteSettlement, moneyKeys, type Settlement } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BEN, CLEO, GROUP_ID, ME, renderWithClient, seededClient } from '../expenses/test-utils'
import { SettlementActions } from './settlement-actions'

vi.mock('@/lib/supabase', () => import('@/features/expenses/fake-supabase'))
vi.mock('@potluck/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  deleteSettlement: vi.fn(async () => ({})),
}))

const remove = vi.mocked(deleteSettlement)

function payment(patch: Partial<Settlement> = {}): Settlement {
  return {
    id: 's1',
    group_id: GROUP_ID,
    from_user: BEN,
    to_user: CLEO,
    amount_cents: 2000,
    currency: 'USD',
    fx_rate: 1,
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
  renderWithClient(
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

const menuButton = () => screen.queryByRole('button', { name: 'Options for Ben paid Cleo $20.00' })

describe('SettlementActions', () => {
  beforeEach(() => remove.mockClear())

  it('is hidden from a member who had nothing to do with the payment', () => {
    setup(payment(), 'member')
    expect(menuButton()).not.toBeInTheDocument()
  })

  it('is there for the people in the payment and for admins', () => {
    setup(payment({ to_user: ME }), 'member')
    expect(menuButton()).toBeInTheDocument()
  })

  it('deletes the payment after asking, and takes it off the list', async () => {
    const client = setup(payment(), 'admin')
    fireEvent.click(menuButton()!)
    fireEvent.click(await screen.findByRole('button', { name: t('settle.delete') }))
    const dialog = await screen.findByRole('dialog', { name: t('settle.delete') })
    expect(within(dialog).getByText(t('settle.deleteConfirm'))).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: t('settle.delete') }))

    await waitFor(() => expect(remove).toHaveBeenCalledWith(expect.anything(), 's1'))
    expect(await screen.findByText(t('settle.deleted'))).toBeInTheDocument()
    expect(client.getQueryData(moneyKeys.settlements(GROUP_ID))).toEqual([])
  })
})
