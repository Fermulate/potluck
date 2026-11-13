import type * as AuthModule from '@/lib/auth'
import type { GroupDetail } from '@potluck/api'
import { t } from '@potluck/i18n'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { group, groupTables, member, VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { db, emitChange, resetDb } from '@/test/supabase'
import { GroupLayout } from './group-layout'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

function renderLayout(seeded: GroupDetail[], path = '/groups/g-hike') {
  resetDb({ tables: { ...groupTables(...seeded), group_invites: [] } })
  return renderWithProviders(<GroupLayout groupId="g-hike" />, { path })
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
})
