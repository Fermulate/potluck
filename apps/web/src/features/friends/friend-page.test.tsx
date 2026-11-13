import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expense } from '@/features/expenses/test-utils'
import { group, groupTables, member, VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { db, resetDb } from '@/test/supabase'
import { FriendPage } from './friend-page'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

const BEN = 'u-ben'
const person = (id: string, display_name: string) => ({
  id,
  display_name,
  avatar_path: null,
  deleted_at: null,
  is_placeholder: false,
})
const split = (user_id: string, share_cents: number) => ({
  user_id,
  share_cents,
  weight: null,
  adjustment_cents: null,
})

const hike = group()
const direct = group({
  id: 'g-ben',
  name: 'Direct',
  is_direct: true,
  members: [member(VIEWER, 'Ava Chen'), member(BEN, 'Ben Ortiz')],
})

// What friend_balances answers for these ledgers: Hike crew Ben owes 8, the 1:1 tab Ava owes 5.
const friendBalances = [
  { friend_id: BEN, group_id: 'g-hike', currency: 'USD', net_cents: 800, archived: false },
  { friend_id: BEN, group_id: 'g-ben', currency: 'USD', net_cents: -500, archived: false },
]

function seed() {
  return resetDb({
    tables: {
      ...groupTables(hike, direct),
      profiles: [
        person(VIEWER, 'Ava Chen'),
        person(BEN, 'Ben Ortiz'),
        person('u-cleo', 'Cleo Park'),
      ],
      friendships: [{ user_id: VIEWER, friend: person(BEN, 'Ben Ortiz') }],
      expenses: [
        expense({
          id: 'e-tacos',
          group_id: 'g-hike',
          description: 'Tacos',
          amount_cents: 2000,
          paid_by: VIEWER,
          spent_at: '2026-11-04',
          expense_payers: [{ user_id: VIEWER, paid_cents: 2000 }],
          expense_splits: [split(VIEWER, 1000), split(BEN, 1000)],
        }),
        expense({
          id: 'e-gas',
          group_id: 'g-hike',
          description: 'Gas',
          amount_cents: 1000,
          paid_by: 'u-cleo',
          spent_at: '2026-11-05',
          expense_payers: [{ user_id: 'u-cleo', paid_cents: 1000 }],
          expense_splits: [split('u-cleo', 500), split('u-dev', 500)],
        }),
        expense({
          id: 'e-lunch',
          group_id: 'g-ben',
          description: 'Lunch',
          amount_cents: 500,
          paid_by: BEN,
          spent_at: '2026-11-06',
          expense_payers: [{ user_id: BEN, paid_cents: 500 }],
          expense_splits: [split(VIEWER, 500)],
        }),
      ].map((row) => ({ ...row })),
      settlements: [
        {
          id: 's1',
          group_id: 'g-hike',
          from_user: BEN,
          to_user: VIEWER,
          amount_cents: 200,
          currency: 'USD',
          fx_rate: '1.000000000000',
          note: null,
          settled_at: '2026-11-07T10:00:00Z',
          created_by: BEN,
          created_at: '2026-11-07T10:00:00Z',
          deleted_at: null,
        },
      ],
    },
  })
}

function renderPage(friendId = BEN) {
  return renderWithProviders(
    <>
      <FriendPage friendId={friendId} />
      <Toaster label="Notifications" />
    </>,
    { path: `/friends/${friendId}` },
  )
}

describe('FriendPage', () => {
  beforeEach(() => {
    seed().respond('rpc:friend_balances', { data: friendBalances })
  })

  it('nets where you stand across every shared group', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Ben Ortiz', level: 1 })).toBeInTheDocument()
    // Hike crew: Ben owes 10, paid back 2. One-on-one: Ava owes 5. Overall Ben owes 3.
    expect(
      screen.getByText(t('people.friendPage.owesYou', { name: 'Ben Ortiz', amount: '$3.00' })),
    ).toBeInTheDocument()
    const standing = screen.getByRole('region', { name: t('people.friendPage.sharedGroups') })
    const rows = within(standing).getAllByRole('link')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining(t('people.friendPage.oneOnOne')),
      expect.stringContaining('Hike crew'),
    ])
    expect(
      within(rows[1]!).getByText(
        t('people.friendPage.owesYou', { name: 'Ben Ortiz', amount: '$8.00' }),
      ),
    ).toBeInTheDocument()
  })

  it('lists everything the two of you share, newest first, and nothing else', async () => {
    renderPage()
    const history = await screen.findByRole('region', { name: t('people.friendPage.history') })
    const text = history.textContent ?? ''
    expect(text).toContain('Lunch')
    expect(text).toContain('Tacos')
    expect(text).not.toContain('Gas')
    expect(text.indexOf('Lunch')).toBeLessThan(text.indexOf('Tacos'))
    expect(
      within(history).getAllByText(t('people.friendPage.inGroup', { group: 'Hike crew' })),
    ).toHaveLength(2)
  })

  it('settles across every shared group from the same sheet as the friends list', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: t('people.friendPage.settleUp') }))
    expect(
      await screen.findByRole('dialog', { name: t('friends.settle.title', { name: 'Ben' }) }),
    ).toBeInTheDocument()
  })

  it('removes a friend', async () => {
    const { router } = renderPage()
    fireEvent.click(
      await screen.findByRole('button', {
        name: t('people.friendPage.menu', { name: 'Ben Ortiz' }),
      }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: new RegExp(t('people.friendPage.remove')) }),
    )
    const dialog = await screen.findByRole('dialog', { name: t('people.friendPage.remove') })
    fireEvent.click(within(dialog).getByRole('button', { name: t('common.remove') }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/friends'))
    expect(db().rpcArgs('remove_friend')).toEqual([{ friend_id: BEN }])
  })

  it('blocks someone, who is not told', async () => {
    const { router } = renderPage()
    fireEvent.click(
      await screen.findByRole('button', {
        name: t('people.friendPage.menu', { name: 'Ben Ortiz' }),
      }),
    )
    fireEvent.click(
      await screen.findByRole('button', {
        name: new RegExp(t('people.friendPage.block', { name: 'Ben Ortiz' })),
      }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: t('people.friendPage.block', { name: 'Ben Ortiz' }),
    })
    fireEvent.click(within(dialog).getByRole('button', { name: t('members.block') }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/friends'))
    expect(db().rpcArgs('block_user')).toEqual([{ user_id: BEN }])
  })

  it('reports someone', async () => {
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', {
        name: t('people.friendPage.menu', { name: 'Ben Ortiz' }),
      }),
    )
    fireEvent.click(
      await screen.findByRole('button', {
        name: new RegExp(t('people.friendPage.report', { name: 'Ben Ortiz' })),
      }),
    )
    const sheet = await screen.findByRole('dialog', {
      name: t('people.report.title', { name: 'Ben Ortiz' }),
    })
    fireEvent.change(within(sheet).getByLabelText(t('people.report.label')), {
      target: { value: 'Spam links' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('people.report.send') }))
    expect(await screen.findByText(t('people.report.sent'))).toBeInTheDocument()
    const [insert] = db().queries('reports')
    expect(insert?.ops.find((op) => op.method === 'insert')?.args[0]).toEqual({
      subject_user_id: BEN,
      group_id: null,
      reason: 'Spam links',
    })
  })

  it('says so when the person is not someone you know', async () => {
    renderPage('u-nobody')
    expect(await screen.findByText(t('people.friendPage.notFound'))).toBeInTheDocument()
  })

  it('starts the 1:1 tab when adding the first expense together', async () => {
    resetDb({
      tables: {
        ...groupTables(hike),
        profiles: [person(VIEWER, 'Ava Chen'), person(BEN, 'Ben Ortiz')],
        friendships: [],
        expenses: [],
        settlements: [],
      },
    }).respond('rpc:get_or_create_direct_group', { data: 'g-new' })
    const { router } = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: t('people.friendPage.addExpense') }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/new/expense'))
    expect(router.state.location.search).toEqual({ groupId: 'g-new' })
    expect(db().rpcArgs('get_or_create_direct_group')).toEqual([{ friend_id: BEN }])
  })
})
