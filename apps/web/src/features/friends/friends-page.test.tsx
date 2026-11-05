import type * as AuthModule from '@/lib/auth'
import type { GroupDetail } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { group, groupTables, member, VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { db, emitChange, resetDb } from '@/test/supabase'
import { FriendsPage } from './friends-page'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

const person = (id: string, display_name: string, deleted_at: string | null = null) => ({
  id,
  display_name,
  avatar_path: null,
  deleted_at,
})

const withBen = group({
  id: 'g-ben',
  name: '',
  is_direct: true,
  members: [
    member(VIEWER, 'Ava Chen', 'member', 1500),
    member('u-ben', 'Ben Ortiz', 'member', -1500),
  ],
})

function seed({ friends = true, groups = [withBen] as GroupDetail[] } = {}) {
  resetDb({
    tables: {
      ...groupTables(...groups),
      friendships: friends
        ? [
            { user_id: VIEWER, friend: person('u-cleo', 'Cleo Park') },
            { user_id: VIEWER, friend: person('u-ben', 'Ben Ortiz') },
            { user_id: VIEWER, friend: person('u-gone', 'Gone Person', '2026-01-01T00:00:00Z') },
          ]
        : [],
    },
  })
}

function renderPage() {
  return renderWithProviders(
    <>
      <FriendsPage />
      <Toaster label="Notifications" />
    </>,
    { path: '/friends' },
  )
}

const openTab = (name: string) => screen.findByRole('button', { name: t('friends.open', { name }) })

describe('FriendsPage', () => {
  beforeEach(() => seed())

  it('lists friends by name with what they owe, skipping closed accounts', async () => {
    renderPage()
    const ben = await openTab('Ben Ortiz')
    expect(within(ben).getByText('owes you $15.00')).toBeInTheDocument()
    expect(within(await openTab('Cleo Park')).getByText(t('friends.noTab'))).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: /Open tab with/ }).map((b) => b.textContent),
    ).toEqual([expect.stringContaining('Ben'), expect.stringContaining('Cleo')])
    expect(screen.queryByText('Gone Person')).not.toBeInTheDocument()
  })

  it('shows when you owe a friend, or are square', async () => {
    seed({
      groups: [
        {
          ...withBen,
          members: [member(VIEWER, 'Ava Chen'), member('u-ben', 'Ben Ortiz', 'member', 800)],
        },
      ],
    })
    const first = renderPage()
    expect(within(await openTab('Ben Ortiz')).getByText('you owe $8.00')).toBeInTheDocument()
    first.unmount()

    seed({
      groups: [{ ...withBen, members: [member(VIEWER, 'Ava Chen'), member('u-ben', 'Ben Ortiz')] }],
    })
    renderPage()
    expect(within(await openTab('Ben Ortiz')).getByText(t('friends.settled'))).toBeInTheDocument()
  })

  it('opens the existing one to one tab', async () => {
    const { router } = renderPage()
    fireEvent.click(await openTab('Ben Ortiz'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g-ben'))
    expect(db().rpcArgs('get_or_create_direct_group')).toEqual([])
  })

  it('starts a tab with a friend who has none yet', async () => {
    db().respond('rpc:get_or_create_direct_group', { data: 'g-cleo' })
    const { router } = renderPage()
    fireEvent.click(await openTab('Cleo Park'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g-cleo'))
    expect(db().rpcArgs('get_or_create_direct_group')).toEqual([{ friend_id: 'u-cleo' }])
  })

  it('stays put and explains when the tab cannot be opened', async () => {
    db().respond('rpc:get_or_create_direct_group', { error: { message: 'Server error' } })
    const { router } = renderPage()
    fireEvent.click(await openTab('Cleo Park'))
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/friends')
  })

  it('suggests starting a group when there is nobody and nowhere to invite them', async () => {
    seed({ friends: false, groups: [] })
    renderPage()
    expect(await screen.findByText(t('friends.empty.title'))).toBeInTheDocument()
    const [header, empty] = screen.getAllByRole('button', { name: t('friends.empty.action') })
    expect(header).toBeInTheDocument()
    fireEvent.click(empty!)
    const sheet = await screen.findByRole('dialog', { name: t('friends.addTitle') })
    expect(within(sheet).getByText(t('friends.noGroups'))).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: t('groups.new') })).toHaveAttribute(
      'href',
      '/groups?new=true',
    )
  })

  it('invites a friend with a single use link to a group they can share', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    seed({
      groups: [
        withBen,
        group(),
        group({ id: 'g-old', name: 'Old trip', archived_at: '2026-01-01T00:00:00Z' }),
      ],
    })
    db().respond('rpc:create_invite', { data: { code: 'hikecrew-xyz' } })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: t('friends.add') }))
    const sheet = await screen.findByRole('dialog', { name: t('friends.addTitle') })
    expect(within(sheet).queryByRole('button', { name: /Old trip/ })).not.toBeInTheDocument()

    fireEvent.click(await within(sheet).findByRole('button', { name: /Hike crew/ }))

    expect(await screen.findByText(t('invites.linkCopied'))).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/join\/hikecrew-xyz$/))
    const [args] = db().rpcArgs('create_invite') as [Record<string, unknown>]
    expect(args).toMatchObject({ group_id: 'g-hike', role: 'member', max_uses: 1 })
    const days = (Date.parse(args.expires_at as string) - Date.now()) / 86_400_000
    expect(Math.round(days)).toBe(7)
  })

  it('reports a failed invite', async () => {
    seed({ groups: [group()] })
    db().respond('rpc:create_invite', { error: { message: 'Server error' } })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: t('friends.add') }))
    const sheet = await screen.findByRole('dialog', { name: t('friends.addTitle') })
    fireEvent.click(await within(sheet).findByRole('button', { name: /Hike crew/ }))
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument()
  })

  it('refreshes balances when money moves', async () => {
    renderPage()
    await openTab('Ben Ortiz')
    const before = db().queries('friendships').length
    emitChange('settlements')
    await waitFor(() => expect(db().queries('friendships').length).toBeGreaterThan(before))
  })
})
