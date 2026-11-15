import { moneyKeys, paymentKeys, peopleKeys, type Settlement } from '@potluck/api'
import { t } from '@potluck/i18n'
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { resetDb } from '@/test/supabase'
import { BEN, CLEO, GROUP_ID, ME, group, seededClient } from '../expenses/test-utils'
import { EditPayment } from './edit-payment'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))

function payment(patch: Partial<Settlement> = {}): Settlement {
  return {
    id: 's1',
    group_id: GROUP_ID,
    from_user: BEN,
    to_user: ME,
    amount_cents: 2000,
    currency: 'USD',
    fx_rate: '1.000000000000',
    note: null,
    settled_at: '2026-11-04T12:00:00Z',
    created_at: '2026-11-04T18:00:00Z',
    created_by: BEN,
    deleted_at: null,
    ...patch,
  }
}

function renderEdit(p: Settlement, { direct = false, iBlocked = false, archived = false } = {}) {
  const onNotAllowed = vi.fn()
  const client = seededClient((c) => {
    c.setQueryData(paymentKeys.settlement(p.id), p)
    c.setQueryData(moneyKeys.expenses(GROUP_ID), [])
    c.setQueryData(moneyKeys.settlements(GROUP_ID), [])
    c.setQueryData(moneyKeys.simplified(GROUP_ID), [])
    c.setQueryData(moneyKeys.groupInfo(GROUP_ID), {
      ...group,
      archived_at: archived ? '2026-11-10T00:00:00Z' : null,
      ...(direct
        ? { is_direct: true, members: group.members.filter((m) => m.id === ME || m.id === BEN) }
        : {}),
    })
    if (direct) {
      c.setQueryData(peopleKeys.canSplit(BEN), false)
      c.setQueryData(
        peopleKeys.blocks(ME),
        iBlocked ? [{ user_id: BEN, display_name: 'Ben', avatar_path: null, blocked_at: 'x' }] : [],
      )
    }
  })
  renderWithProviders(
    <EditPayment
      paymentId={p.id}
      onClose={() => {}}
      onDone={() => {}}
      onNotAllowed={onNotAllowed}
    />,
    { path: '/payments/$paymentId/edit', url: `/payments/${p.id}/edit`, client },
  )
  return { onNotAllowed }
}

describe('EditPayment', () => {
  beforeEach(() => resetDb())

  it('opens the form for someone who may change the payment', async () => {
    const { onNotAllowed } = renderEdit(payment())
    expect(await screen.findByRole('button', { name: t('settle.saveChanges') })).toBeInTheDocument()
    expect(onNotAllowed).not.toHaveBeenCalled()
  })

  it('sends the blocked side of a tab back on a payment the other person recorded', async () => {
    const { onNotAllowed } = renderEdit(payment({ created_by: BEN }), { direct: true })
    await waitFor(() => expect(onNotAllowed).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: t('settle.saveChanges') })).toBeNull()
  })

  it('still opens a payment the blocked side recorded themselves', async () => {
    const { onNotAllowed } = renderEdit(payment({ created_by: ME, from_user: ME, to_user: BEN }), {
      direct: true,
    })
    expect(await screen.findByRole('button', { name: t('settle.saveChanges') })).toBeInTheDocument()
    expect(onNotAllowed).not.toHaveBeenCalled()
  })

  it('opens any payment there for the person who blocked', async () => {
    const { onNotAllowed } = renderEdit(payment({ created_by: BEN }), {
      direct: true,
      iBlocked: true,
    })
    expect(await screen.findByRole('button', { name: t('settle.saveChanges') })).toBeInTheDocument()
    expect(onNotAllowed).not.toHaveBeenCalled()
  })

  it.each([
    ['a member who was not part of it', payment({ from_user: BEN, to_user: CLEO })],
    ['a deleted payment', payment({ deleted_at: '2026-11-05T00:00:00Z' })],
  ])('sends %s back to the payment', async (_case, p) => {
    const { onNotAllowed } = renderEdit(p)
    await waitFor(() => expect(onNotAllowed).toHaveBeenCalledTimes(1))
  })

  it('sends people back from a payment in an archived group', async () => {
    const { onNotAllowed } = renderEdit(payment(), { archived: true })
    await waitFor(() => expect(onNotAllowed).toHaveBeenCalledTimes(1))
  })
})
