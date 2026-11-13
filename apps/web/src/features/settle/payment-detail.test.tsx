import { moneyKeys, paymentKeys, type Settlement } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { db, resetDb } from '@/test/supabase'
import { BEN, CLEO, GROUP_ID, ME, group, seededClient } from '../expenses/test-utils'
import { PaymentDetail } from './payment-detail'

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
    note: 'Cash at the trailhead',
    settled_at: '2026-11-04T12:00:00Z',
    created_at: '2026-11-04T18:00:00Z',
    created_by: BEN,
    deleted_at: null,
    ...patch,
  }
}

function renderPayment(p: Settlement, { members = group.members } = {}) {
  const client = seededClient((c) => {
    c.setQueryData(paymentKeys.settlement(p.id), p)
    c.setQueryData(paymentKeys.comments(p.id), [])
    c.setQueryData(moneyKeys.groupInfo(GROUP_ID), { ...group, members })
  })
  return renderWithProviders(
    <>
      <PaymentDetail paymentId={p.id} />
      <Toaster label="Notifications" />
    </>,
    { path: '/payments/$paymentId', url: `/payments/${p.id}`, client },
  )
}

describe('PaymentDetail', () => {
  beforeEach(() => resetDb({ tables: { comments: [] } }))

  it('says who paid whom, when, and the note', async () => {
    renderPayment(payment())
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ben paid you' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Cash at the trailhead')).toBeInTheDocument()
    expect(screen.getByText(/Recorded by Ben/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('common.edit') })).toHaveAttribute(
      'href',
      '/payments/s1/edit',
    )
  })

  it('shows the group currency value of a foreign payment', async () => {
    renderPayment(payment({ currency: 'EUR', fx_rate: '1.100000000000' }))
    expect(await screen.findByText('$22.00 in USD at 1.1')).toBeInTheDocument()
  })

  it('takes comments on the payment', async () => {
    db().respond('from:comments', {
      data: {
        id: 'c1',
        settlement_id: 's1',
        author_id: ME,
        body: 'Thanks!',
        created_at: '2026-11-04T19:00:00Z',
      },
    })
    renderPayment(payment())
    const box = await screen.findByRole('textbox', { name: t('expenses.comments.placeholder') })
    fireEvent.change(box, { target: { value: 'Thanks!' } })
    fireEvent.click(screen.getByRole('button', { name: t('expenses.comments.send') }))
    expect(await screen.findByText('Thanks!')).toBeInTheDocument()
    await waitFor(() =>
      expect(
        db()
          .queries('comments')
          .some((q) => q.ops.some((op) => op.method === 'insert')),
      ).toBe(true),
    )
  })

  it('offers Restore on a deleted payment to the people who could delete it', async () => {
    db().respond('rpc:restore_settlement', { data: payment() })
    renderPayment(payment({ deleted_at: '2026-11-05T00:00:00Z' }))
    const banner = await screen.findByRole('status')
    expect(within(banner).getByText(t('settle.detail.deletedBanner'))).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: t('common.edit') })).not.toBeInTheDocument()
    fireEvent.click(within(banner).getByRole('button', { name: t('settle.restore') }))
    expect(await screen.findByText(t('settle.restored'))).toBeInTheDocument()
    expect(db().rpcArgs('restore_settlement')).toEqual([{ id: 's1' }])
  })

  it('hides Restore from members who were not part of it', async () => {
    renderPayment(payment({ to_user: CLEO, deleted_at: '2026-11-05T00:00:00Z' }))
    expect(await screen.findByText(t('settle.detail.deletedBanner'))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('settle.restore') })).not.toBeInTheDocument()
  })

  it('locks a payment with someone who left to its details', async () => {
    renderPayment(payment(), { members: group.members.filter((m) => m.id !== BEN) })
    expect(await screen.findByRole('note')).toHaveTextContent(t('settle.detail.departedLocked'))
    expect(screen.queryByRole('button', { name: t('settle.delete') })).not.toBeInTheDocument()
  })

  it('deletes after asking and offers Undo', async () => {
    db().respond('rpc:delete_settlement', { data: payment({ deleted_at: 'now' }) })
    const { router } = renderPayment(payment())
    fireEvent.click(await screen.findByRole('button', { name: t('settle.delete') }))
    const dialog = await screen.findByRole('dialog', { name: t('settle.delete') })
    fireEvent.click(within(dialog).getByRole('button', { name: t('settle.delete') }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/groups/${GROUP_ID}`))
    expect(db().rpcArgs('delete_settlement')).toEqual([{ id: 's1' }])
  })

  it('says when the payment cannot be found', async () => {
    db().respond('from:settlements', { error: { message: 'not found', code: 'PGRST116' } })
    const client = seededClient()
    renderWithProviders(<PaymentDetail paymentId="missing" />, {
      path: '/payments/$paymentId',
      url: '/payments/missing',
      client,
    })
    expect(await screen.findByText(t('settle.detail.notFound'))).toBeInTheDocument()
  })
})
