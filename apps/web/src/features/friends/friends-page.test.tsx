import type * as AuthModule from '@/lib/auth'
import type { GroupDetail } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { group, groupTables, member, VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { db, emitChange, resetDb, subscriptions } from '@/test/supabase'
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

/** A friend's row: the link to their page, whose name starts with what it shows, their name. */
const openTab = (name: string) =>
  screen.findByRole('link', { name: new RegExp(`^(\\S+ )?${name}`) })

describe('FriendsPage', () => {
  beforeEach(() => seed())

  it('lists friends by name with what they owe, skipping closed accounts', async () => {
    renderPage()
    const ben = await openTab('Ben Ortiz')
    expect(ben).toHaveTextContent('owes you$15.00')
    expect(within(await openTab('Cleo Park')).getByText(t('friends.noTab'))).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: /Ben Ortiz|Cleo Park/ }).map((b) => b.textContent),
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
    expect(await openTab('Ben Ortiz')).toHaveTextContent('you owe$8.00')
    first.unmount()

    seed({
      groups: [{ ...withBen, members: [member(VIEWER, 'Ava Chen'), member('u-ben', 'Ben Ortiz')] }],
    })
    renderPage()
    expect(within(await openTab('Ben Ortiz')).getByText(t('friends.settled'))).toBeInTheDocument()
  })

  it('opens the friend page', async () => {
    renderPage()
    expect(await openTab('Ben Ortiz')).toHaveAttribute('href', '/friends/u-ben')
  })

  it('suggests people from your groups who are not friends, never placeholders', async () => {
    seed({
      groups: [
        withBen,
        group({
          members: [...group().members, { ...member('p-sam', 'Sam Lee'), is_placeholder: true }],
        }),
      ],
    })
    db().respond('rpc:my_blocks', {
      data: [{ user_id: 'u-dev', display_name: 'Dev Patel', avatar_path: null, blocked_at: 't' }],
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: t('friends.add') }))
    const sheet = await screen.findByRole('dialog', { name: t('friends.addTitle') })
    // Ben and Cleo are friends, Dev is blocked and Sam is not on Potluck yet.
    await within(sheet).findByRole('button', { name: /Hike crew/ })
    await waitFor(() => expect(db().rpcArgs('my_blocks')).toHaveLength(1))
    expect(within(sheet).queryByText(t('people.addFriend.suggestions'))).toBeNull()
  })

  it('adds back someone you share a group with', async () => {
    seed({ friends: false, groups: [group()] })
    db().respond('rpc:my_blocks', { data: [] })
    renderPage()
    fireEvent.click((await screen.findAllByRole('button', { name: t('friends.add') }))[0]!)
    const sheet = await screen.findByRole('dialog', { name: t('friends.addTitle') })
    const add = await within(sheet).findByRole('button', {
      name: t('people.addFriend.addName', { name: 'Ben Ortiz' }),
    })
    expect(
      within(sheet)
        .getAllByRole('button', { name: /as a friend$/ })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      t('people.addFriend.addName', { name: 'Ben Ortiz' }),
      t('people.addFriend.addName', { name: 'Cleo Park' }),
      t('people.addFriend.addName', { name: 'Dev Patel' }),
    ])
    fireEvent.click(add)
    expect(
      await screen.findByText(t('people.addFriend.added', { name: 'Ben Ortiz' })),
    ).toBeInTheDocument()
    expect(db().rpcArgs('add_friend')).toEqual([{ user_id: 'u-ben' }])
  })

  it('copies the personal friend link', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    db().respond('rpc:my_friend_link', { data: 'ava-link-123' })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: t('friends.add') }))
    const sheet = await screen.findByRole('dialog', { name: t('friends.addTitle') })
    await within(sheet).findByText(/ava-link-123/)
    fireEvent.click(within(sheet).getByRole('button', { name: t('people.friendLink.copy') }))
    expect(await screen.findByText(t('people.friendLink.copied'))).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/friend.ava-link-123$/))
  })

  it('makes a new friend link', async () => {
    db().respond('rpc:my_friend_link', { data: 'old-link-123' }, { data: 'new-link-456' })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: t('friends.add') }))
    const sheet = await screen.findByRole('dialog', { name: t('friends.addTitle') })
    await within(sheet).findByText(/old-link-123/)
    fireEvent.click(within(sheet).getByRole('button', { name: t('people.friendLink.rotate') }))
    expect(await within(sheet).findByText(/new-link-456/)).toBeInTheDocument()
    expect(db().rpcArgs('my_friend_link')).toEqual([{ rotate: false }, { rotate: true }])
  })

  it('makes an email invite and hands it to the mail app', async () => {
    db().respond('rpc:create_friend_invite', { data: { code: 'mail-link-789' } })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: t('friends.add') }))
    const sheet = await screen.findByRole('dialog', { name: t('friends.addTitle') })
    const input = within(sheet).getByLabelText(t('people.friendEmail.label'))
    fireEvent.change(input, { target: { value: 'nope' } })
    fireEvent.click(within(sheet).getByRole('button', { name: t('people.friendEmail.send') }))
    expect(await within(sheet).findByText(t('errors.validation.invalidEmail'))).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'Cleo@Example.com' } })
    fireEvent.click(within(sheet).getByRole('button', { name: t('people.friendEmail.send') }))
    expect(await screen.findByText(t('people.friendEmail.ready'))).toBeInTheDocument()
    expect(db().rpcArgs('create_friend_invite')).toEqual([{ email: 'cleo@example.com' }])
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

  it('adds up every shared group and settles them all in one go', async () => {
    seed({ groups: [withBen, group({ id: 'g-hike', name: 'Hike crew' })] })
    db().respond('rpc:friend_balances', {
      data: [
        {
          friend_id: 'u-ben',
          group_id: 'g-ben',
          currency: 'USD',
          net_cents: 1500,
          archived: false,
        },
        {
          friend_id: 'u-ben',
          group_id: 'g-hike',
          currency: 'USD',
          net_cents: 500,
          archived: false,
        },
        { friend_id: 'u-ben', group_id: 'g-old', currency: 'EUR', net_cents: -700, archived: true },
      ],
    })
    db().respond('rpc:settle_with_friend', {
      data: [{ group_id: 'g-ben' }, { group_id: 'g-hike' }],
    })
    renderPage()
    const ben = await openTab('Ben Ortiz')
    await waitFor(() => expect(ben).toHaveTextContent(/you owe€7\.00\s*owes you\$20\.00/))
    expect(screen.getByText(t('friends.acrossGroups', { count: 3 }))).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: t('friends.settle.actionLabel', { name: 'Ben Ortiz' }) }),
    )
    const sheet = await screen.findByRole('dialog', {
      name: t('friends.settle.title', { name: 'Ben' }),
    })
    expect(within(sheet).getByText(t('friends.settle.archived', { count: 1 }))).toBeInTheDocument()
    expect(
      within(sheet).getByText(t('friends.settle.owesYou', { amount: '$5.00' })),
    ).toBeInTheDocument()
    fireEvent.click(
      within(sheet).getByRole('button', { name: t('friends.settle.record', { count: 2 }) }),
    )

    expect(await screen.findByText(t('friends.settle.done', { name: 'Ben' }))).toBeInTheDocument()
    expect(db().rpcArgs('settle_with_friend')).toEqual([{ friend_id: 'u-ben' }])
  })

  it('settles only the picked groups, and part of an amount', async () => {
    seed({ groups: [withBen, group({ id: 'g-hike', name: 'Hike crew' })] })
    db().respond('rpc:friend_balances', {
      data: [
        {
          friend_id: 'u-ben',
          group_id: 'g-ben',
          currency: 'USD',
          net_cents: 1500,
          archived: false,
        },
        {
          friend_id: 'u-ben',
          group_id: 'g-hike',
          currency: 'USD',
          net_cents: 500,
          archived: false,
        },
      ],
    })
    db().respond('rpc:settle_with_friend', { data: [{ group_id: 'g-hike' }] })
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', {
        name: t('friends.settle.actionLabel', { name: 'Ben Ortiz' }),
      }),
    )
    const sheet = await screen.findByRole('dialog', {
      name: t('friends.settle.title', { name: 'Ben' }),
    })
    fireEvent.click(
      within(sheet).getByRole('checkbox', {
        name: t('friends.settle.include', { group: 'Ben Ortiz' }),
      }),
    )
    const amount = within(sheet).getByRole('textbox', {
      name: t('friends.settle.amountFor', { group: 'Hike crew', currency: 'USD' }),
    })
    // The box says which currency it is in.
    expect(amount.parentElement).toHaveTextContent('$')
    fireEvent.change(amount, { target: { value: '9' } })
    expect(within(sheet).getByRole('alert')).toHaveTextContent(
      t('friends.settle.upTo', { amount: '$5.00' }),
    )
    const record = within(sheet).getByRole('button', {
      name: t('friends.settle.record', { count: 1 }),
    })
    expect(record).toBeDisabled()

    fireEvent.change(amount, { target: { value: '2.50' } })
    fireEvent.click(record)
    expect(await screen.findByText(t('friends.settle.partDone', { count: 1 }))).toBeInTheDocument()
    expect(db().rpcArgs('settle_with_friend')).toEqual([
      { friend_id: 'u-ben', amounts: { 'g-hike': 250 } },
    ])
  })

  it('leaves a group that gains a debt while the sheet is open unpicked', async () => {
    seed({ groups: [withBen, group({ id: 'g-hike', name: 'Hike crew' })] })
    const row = (group_id: string, net_cents: number) => ({
      friend_id: 'u-ben',
      group_id,
      currency: 'USD',
      net_cents,
      archived: false,
    })
    let balances = [row('g-ben', 1500)]
    db().respond('rpc:friend_balances', () => ({ data: balances }))
    db().respond('rpc:settle_with_friend', { data: [{ group_id: 'g-ben' }] })
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', {
        name: t('friends.settle.actionLabel', { name: 'Ben Ortiz' }),
      }),
    )
    const sheet = await screen.findByRole('dialog', {
      name: t('friends.settle.title', { name: 'Ben' }),
    })

    balances = [row('g-ben', 1500), row('g-hike', 500)]
    emitChange('settlements')
    const hike = await within(sheet).findByRole('checkbox', {
      name: t('friends.settle.include', { group: 'Hike crew' }),
    })
    expect(hike).not.toBeChecked()
    expect(
      within(sheet).getByRole('textbox', {
        name: t('friends.settle.amountFor', { group: 'Hike crew', currency: 'USD' }),
      }),
    ).toBeDisabled()

    fireEvent.click(
      within(sheet).getByRole('button', { name: t('friends.settle.record', { count: 1 }) }),
    )
    expect(await screen.findByText(t('friends.settle.partDone', { count: 1 }))).toBeInTheDocument()
    expect(db().rpcArgs('settle_with_friend')).toEqual([
      { friend_id: 'u-ben', amounts: { 'g-ben': 1500 } },
    ])
  })

  it('refreshes balances when money moves', async () => {
    renderPage()
    await openTab('Ben Ortiz')
    const before = db().queries('friendships').length
    emitChange('settlements')
    await waitFor(() => expect(db().queries('friendships').length).toBeGreaterThan(before))
  })

  it("listens to money moving in the viewer's groups only", async () => {
    renderPage()
    await openTab('Ben Ortiz')
    await waitFor(() =>
      expect(subscriptions()).toContainEqual({
        table: 'settlements',
        filter: `group_id=in.(${withBen.id})`,
      }),
    )
    expect(subscriptions().filter((s) => !s.filter)).toEqual([
      { table: 'group_members', filter: undefined },
    ])
  })
})
