import type * as AuthModule from '@/lib/auth'
import type { GroupDetail } from '@potluck/api'
import { t } from '@potluck/i18n'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { group, groupTables, member, VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { db, emitChange, resetDb } from '@/test/supabase'
import { rememberGroupFilters } from '@/features/insights/group-filters'
import { GroupLayout } from './group-layout'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

function renderLayout(seeded: GroupDetail[], path = '/groups/g-hike', url = path) {
  resetDb({ tables: { ...groupTables(...seeded), group_invites: [] } })
  return renderWithProviders(<GroupLayout groupId="g-hike" />, { path, url })
}

function tabs() {
  return within(screen.getByRole('navigation', { name: t('groups.tabs.label') }))
}

describe('GroupLayout', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the group header, the viewer balance and every section tab', async () => {
    renderLayout([group()])
    expect(await screen.findByRole('heading', { name: 'Hike crew' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /4 members/ })).toHaveAttribute(
      'href',
      '/groups/g-hike/members',
    )
    expect(screen.getByText(t('groups.header.youOwe', { amount: '$60.51' }))).toBeInTheDocument()
    expect(
      tabs()
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      t('groups.tabs.expenses'),
      t('groups.tabs.balances'),
      t('insights.tab'),
      t('groups.tabs.plans'),
      t('groups.tabs.notes'),
      t('groups.tabs.members'),
      t('groups.tabs.settings'),
    ])
    expect(tabs().getByRole('link', { name: t('groups.tabs.expenses') })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: t('groups.header.back') })).toHaveAttribute(
      'href',
      '/groups',
    )
  })

  it('marks the tab for the current section', async () => {
    renderLayout([group()], '/groups/g-hike/balances')
    await screen.findByRole('heading', { name: 'Hike crew' })
    expect(tabs().getByRole('link', { name: t('groups.tabs.balances') })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(tabs().getByRole('link', { name: t('groups.tabs.expenses') })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('brings the Expenses filters back from other tabs, and keeps the ones in use on Expenses', async () => {
    rememberGroupFilters('g-hike', { cats: 'food' })
    const balances = renderLayout([group()], '/groups/g-hike/balances')
    await screen.findByRole('heading', { name: 'Hike crew' })
    expect(tabs().getByRole('link', { name: t('groups.tabs.expenses') })).toHaveAttribute(
      'href',
      '/groups/g-hike?cats=food',
    )
    balances.unmount()

    // On Expenses the filters were changed since; the tab must not bring the old ones back.
    renderLayout([group()], '/groups/g-hike', '/groups/g-hike?cats=rent')
    await screen.findByRole('heading', { name: 'Hike crew' })
    expect(tabs().getByRole('link', { name: t('groups.tabs.expenses') })).toHaveAttribute(
      'href',
      '/groups/g-hike?cats=rent',
    )
    rememberGroupFilters('g-hike', {})
  })

  it('opens the invite sheet', async () => {
    renderLayout([group()])
    fireEvent.click(await screen.findByRole('button', { name: t('groups.header.invite') }))
    expect(await screen.findByRole('dialog', { name: t('invites.title') })).toBeInTheDocument()
  })

  it('hides invites from plain members when only admins may invite, and flags archived groups', async () => {
    renderLayout([
      group({
        members_can_invite: false,
        archived_at: '2026-10-01T00:00:00Z',
        members: [member('u-ben', 'Ben Ortiz', 'owner'), member(VIEWER, 'Ava Chen', 'member')],
      }),
    ])
    await screen.findByRole('heading', { name: 'Hike crew' })
    expect(
      screen.queryByRole('button', { name: t('groups.header.invite') }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(t('groups.settings.archived', { group: 'Hike crew' }))).toBeVisible()
    expect(screen.getByText(t('groups.header.settled'))).toBeInTheDocument()
  })

  it('shows the friend instead of group chrome in a one to one tab', async () => {
    renderLayout([
      group({
        is_direct: true,
        members: [member(VIEWER, 'Ava Chen', 'member', 2500), member('u-ben', 'Ben Ortiz')],
      }),
    ])
    expect(
      await screen.findByRole('heading', { name: t('groups.header.withFriend', { name: 'Ben' }) }),
    ).toBeInTheDocument()
    expect(screen.getByText('Ben owes you $25.00')).toBeInTheDocument()
    expect(tabs().getAllByRole('link')).toHaveLength(3)
    expect(screen.getByRole('link', { name: t('nav.friends') })).toHaveAttribute('href', '/friends')
    expect(
      screen.getByRole('link', { name: t('activityFilter.personLink', { name: 'Ben' }) }),
    ).toHaveAttribute('href', '/activity?person=u-ben')
  })

  it('says who owes whom in either direction, or all square', async () => {
    const direct = (net: number) =>
      group({
        is_direct: true,
        members: [member(VIEWER, 'Ava Chen', 'member', net), member('u-ben', 'Ben Ortiz')],
      })
    const first = renderLayout([direct(-1200)])
    expect(await screen.findByText('You owe Ben $12.00')).toBeInTheDocument()
    first.unmount()

    renderLayout([direct(0)])
    expect(await screen.findByText(t('groups.allSquare'))).toBeInTheDocument()
  })

  it('says so when the group does not exist', async () => {
    renderLayout([])
    expect(await screen.findByText(t('errors.groupNotFound'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('groups.header.back') })).toHaveAttribute(
      'href',
      '/groups',
    )
  })

  it('refetches when money moves in the group', async () => {
    renderLayout([group()])
    await screen.findByRole('heading', { name: 'Hike crew' })
    const before = db().queries('groups').length
    emitChange('expenses')
    await waitFor(() => expect(db().queries('groups').length).toBeGreaterThan(before))
  })

  it('puts the cover above the header and shows a trip with its dates', async () => {
    renderLayout([
      group({
        type: 'trip',
        starts_on: '2026-06-03',
        ends_on: '2026-06-10',
        cover_path: 'g-hike/cover.webp',
      }),
    ])
    expect(await screen.findByText('Jun 3 to Jun 10')).toBeInTheDocument()
    // Decorative next to the group name, so it has an empty alt.
    expect(document.querySelector('header img')).toHaveAttribute(
      'src',
      expect.stringContaining('g-hike/cover.webp'),
    )
    expect(tabs().getByRole('link', { name: t('groups.tabs.notes') })).toHaveAttribute(
      'href',
      '/groups/g-hike/notes',
    )
  })

  it('keeps a long name to two lines, whole on hover and opened out on a tap', async () => {
    const name = 'Book club with an extraordinarily long name that keeps going and going forever'
    // jsdom has no layout: report a heading taller than its two clamped lines.
    const tall = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(200)
    const short = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(80)
    renderLayout([group({ name })])
    const heading = await screen.findByRole('heading', { level: 1, name })
    expect(heading).toHaveAttribute('title', name)
    const more = within(heading).getByRole('button', { name })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    tall.mockRestore()
    short.mockRestore()
  })

  it('shows a name that fits as plain text', async () => {
    renderLayout([group()])
    const heading = await screen.findByRole('heading', { level: 1, name: 'Hike crew' })
    expect(heading).toHaveAttribute('title', 'Hike crew')
    expect(within(heading).queryByRole('button')).toBeNull()
  })

  it('shows only the first or last day when that is all a trip has', async () => {
    renderLayout([group({ type: 'trip', starts_on: '2026-06-03' })])
    expect(await screen.findByText('From Jun 3')).toBeInTheDocument()
  })

  it('shows the last day alone too, and no dates for other types', async () => {
    const { unmount } = renderLayout([group({ type: 'trip', ends_on: '2026-06-10' })])
    expect(await screen.findByText('Until Jun 10')).toBeInTheDocument()
    unmount()
    renderLayout([group({ type: 'home', starts_on: '2026-06-03', ends_on: '2026-06-10' })])
    expect(await screen.findByRole('heading', { name: 'Hike crew' })).toBeInTheDocument()
    expect(screen.queryByText(/Jun 3|Jun 10/)).not.toBeInTheDocument()
  })

  it('says a deleted group was deleted and lets any member restore it', async () => {
    resetDb({ tables: { group_invites: [] } })
    db().respond('rpc:my_deleted_groups', {
      data: [
        {
          id: 'g-hike',
          name: 'Hike crew',
          emoji: '🥾',
          color: 'olive',
          type: 'other',
          cover_path: null,
          deleted_at: new Date().toISOString(),
          deleted_by: 'u-ben',
          purge_after: '',
          member_count: 3,
        },
      ],
    })
    const { router } = renderWithProviders(<GroupLayout groupId="g-hike" />, {
      path: '/groups/g-hike',
    })
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: t('groups.deleted.pageTitle', { group: 'Hike crew' }),
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(t('groups.deleted.daysLeft', { count: 30 }))).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', {
        name: t('groups.deleted.restoreLabel', { group: 'Hike crew' }),
      }),
    )
    await waitFor(() => expect(db().rpcArgs('restore_group')).toEqual([{ group_id: 'g-hike' }]))
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g-hike'))
  })

  it('still says not found for a group the viewer was never in', async () => {
    resetDb({ tables: { group_invites: [] } })
    db().respond('rpc:my_deleted_groups', { data: [] })
    renderWithProviders(<GroupLayout groupId="g-nope" />, { path: '/groups/g-nope' })
    expect(await screen.findByText(t('errors.groupNotFound'))).toBeInTheDocument()
  })
})
