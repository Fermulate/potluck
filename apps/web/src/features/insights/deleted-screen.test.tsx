import { groupKeys, moneyKeys } from '@potluck/api'
import type * as UiModule from '@potluck/ui'
import { t } from '@potluck/i18n'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { db, resetDb } from '@/test/supabase'
import { BEN, GROUP_ID, ME, group, members, seededClient } from '../expenses/test-utils'
import { DeletedScreen } from './deleted-screen'
import { SpendingScreen } from './spending-screen'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@potluck/ui', async (actual) => ({
  ...(await actual<typeof UiModule>()),
  toast: toasts,
}))

const deleted = (patch: object) => ({
  kind: 'expense',
  id: 'e-mine',
  group_id: GROUP_ID,
  day: '2026-03-05',
  description: 'Groceries',
  category: 'groceries',
  amount_cents: 1200,
  currency: 'USD',
  paid_by: ME,
  to_user: null,
  created_by: ME,
  deleted_at: '2026-03-06T10:00:00Z',
  deleted_by: ME,
  payers: [ME],
  ...patch,
})

function renderDeleted(rows: object[], role: 'member' | 'admin' = 'member', archived = false) {
  resetDb()
    .respond('rpc:deleted_items', { data: rows })
    .respond('rpc:restore_expense', { data: { id: 'e-mine' } })
    .respond('rpc:restore_settlement', { data: { id: 's1' } })
  const client = seededClient((c) =>
    c.setQueryData(moneyKeys.groupInfo(GROUP_ID), {
      ...group,
      archived_at: archived ? '2026-03-01T00:00:00Z' : null,
      members: members.map((m) => (m.id === ME ? { ...m, role } : m)),
    }),
  )
  return renderWithProviders(<DeletedScreen groupId={GROUP_ID} />, {
    path: '/groups/$groupId/deleted',
    url: `/groups/${GROUP_ID}/deleted`,
    client,
  })
}

const others = deleted({
  id: 'e-ben',
  description: 'Firewood',
  paid_by: BEN,
  created_by: BEN,
  deleted_by: BEN,
  payers: [BEN],
})
const payment = deleted({
  kind: 'payment',
  id: 's1',
  description: null,
  category: null,
  paid_by: BEN,
  to_user: ME,
  created_by: BEN,
  deleted_by: null,
  payers: [BEN],
})

describe('DeletedScreen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists deleted items, with Restore only where the viewer may', async () => {
    renderDeleted([deleted({}), others, payment])
    const list = await screen.findByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(
      screen.getByRole('button', {
        name: t('deletedItems.restoreLabel', { description: 'Groceries' }),
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Firewood/ })).toBeNull()
    // A payment opens its own page, and the person it was paid to may restore it.
    expect(screen.getByRole('link', { name: 'Ben paid you' })).toHaveAttribute(
      'href',
      '/payments/s1',
    )
    expect(
      screen.getByRole('button', {
        name: t('deletedItems.restoreLabel', { description: 'Ben paid you' }),
      }),
    ).toBeInTheDocument()
    expect(screen.getAllByText(/^Deleted by you /)).toHaveLength(1)
    expect(screen.getAllByText(/^Deleted by Ben /)).toHaveLength(1)
    expect(screen.getAllByText(/^Deleted by /)).toHaveLength(2)
    expect(db().rpcArgs('deleted_items')[0]).toMatchObject({ in_group: GROUP_ID })
  })

  it('lets admins restore anything, and restores through the RPC', async () => {
    renderDeleted([others], 'admin')
    fireEvent.click(
      await screen.findByRole('button', {
        name: t('deletedItems.restoreLabel', { description: 'Firewood' }),
      }),
    )
    await waitFor(() => expect(db().rpcArgs('restore_expense')).toEqual([{ id: 'e-ben' }]))
    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith(
        t('deletedItems.restored', { description: 'Firewood' }),
      ),
    )
  })

  it('restores a payment through restore_settlement', async () => {
    renderDeleted([payment])
    fireEvent.click(
      await screen.findByRole('button', {
        name: t('deletedItems.restoreLabel', { description: 'Ben paid you' }),
      }),
    )
    await waitFor(() => expect(db().rpcArgs('restore_settlement')).toEqual([{ id: 's1' }]))
  })

  it('lets someone who paid part of an expense restore it', async () => {
    renderDeleted([
      deleted({ id: 'e-two', description: 'Rent', created_by: BEN, payers: [BEN, ME] }),
    ])
    expect(
      await screen.findByRole('button', {
        name: t('deletedItems.restoreLabel', { description: 'Rent' }),
      }),
    ).toBeInTheDocument()
  })

  it('offers no Restore in an archived group', async () => {
    renderDeleted([deleted({})], 'admin', true)
    await screen.findByRole('list')
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull()
  })

  it('has a friendly empty state', async () => {
    renderDeleted([])
    expect(await screen.findByText(t('deletedItems.empty.title'))).toBeInTheDocument()
  })
})

describe('SpendingScreen', () => {
  const row = (patch: object) => ({
    group_id: GROUP_ID,
    currency: 'USD',
    month: '2026-03-01',
    category: 'food',
    expense_count: 1,
    spend_cents: 9000,
    paid_cents: 9000,
    share_cents: 3000,
    payments_made_cents: 0,
    payments_received_cents: 0,
    unconverted_count: 0,
    ...patch,
  })

  function renderSpending(rows: object[], converted: object[] = []) {
    resetDb().respond('rpc:spending_summary', (call) =>
      (call as { args: { in_currency?: string } }).args.in_currency
        ? { data: converted }
        : { data: rows },
    )
    const client = seededClient((c) =>
      c.setQueryData(groupKeys.list(ME), [
        { ...group, members: [], my_role: 'member', my_net_cents: 0 },
        {
          ...group,
          id: 'g-eu',
          name: 'Paris',
          emoji: '🥐',
          currency: 'EUR',
          members: [],
          my_role: 'member',
          my_net_cents: 0,
        },
      ]),
    )
    return renderWithProviders(<SpendingScreen />, { path: '/insights', client })
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-20T18:00:00Z'))
    return () => vi.useRealTimers()
  })

  it('opens with everything in the default currency, with spending by group', async () => {
    renderSpending(
      [
        row({}),
        row({
          group_id: 'g-eu',
          currency: 'EUR',
          category: 'lodging',
          spend_cents: 50000,
          share_cents: 25000,
        }),
      ],
      [
        row({}),
        row({
          group_id: 'g-eu',
          category: 'lodging',
          spend_cents: 55000,
          share_cents: 27500,
          unconverted_count: 2,
        }),
      ],
    )
    const totals = await screen.findByRole('region', { name: t('insights.totals.label') })
    await waitFor(() => expect(within(totals).getByText('$305.00')).toBeInTheDocument())
    expect(db().rpcArgs('spending_summary')).toContainEqual({ in_currency: 'USD' })
    expect(screen.getByRole('combobox', { name: t('insights.view') })).toHaveTextContent(
      t('insights.convertedTo', { currency: 'USD' }),
    )
    expect(screen.getByText(t('insights.convertedNote'))).toBeInTheDocument()
    expect(
      screen.getByText(t('insights.unconverted', { count: 2, list: 'Paris (EUR)' })),
    ).toBeInTheDocument()
    const groups = screen.getByRole('list', { name: t('insights.byGroup.title') })
    // Named by what it shows, so the name matches the visible text.
    const link = within(groups).getByRole('link', {
      name: /^Hike crew, ?\$30\.00, 10% of the total$/,
    })
    expect(link).toHaveAttribute('href', `/groups/${GROUP_ID}/totals`)
    expect(link).not.toHaveAttribute('aria-label')
    expect(within(groups).getByText('Paris')).toBeInTheDocument()
  })

  it('needs no picker when everything is already in the default currency', async () => {
    renderSpending([row({})])
    await screen.findByRole('region', { name: t('insights.totals.label') })
    expect(screen.queryByRole('combobox', { name: t('insights.view') })).toBeNull()
    expect(db().rpcArgs('spending_summary')).toEqual([{}])
  })

  it('invites a first expense when there is nothing yet', async () => {
    renderSpending([])
    expect(await screen.findByText(t('insights.empty.title'))).toBeInTheDocument()
  })
})
