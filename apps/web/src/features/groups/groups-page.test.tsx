import type * as ApiModule from '@potluck/api'
import type * as AuthModule from '@/lib/auth'
import type { DeletedGroup, GroupDetail } from '@potluck/api'
import { t } from '@potluck/i18n'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { group, VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { Toaster } from '@potluck/ui'
import { GroupsPage } from './groups-page'

const api = vi.hoisted(() => ({
  groups: [] as GroupDetail[],
  deleted: [] as DeletedGroup[],
  restoreGroup: vi.fn(async () => ({})),
}))

vi.mock('@potluck/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return {
    ...actual,
    myGroupsQueryOptions: () => ({
      queryKey: ['test', 'groups'],
      queryFn: async () => api.groups,
    }),
    deletedGroupsQueryOptions: () => ({
      queryKey: ['test', 'deleted'],
      queryFn: async () => api.deleted,
    }),
    restoreGroup: api.restoreGroup,
    moneyQueries: {
      ...actual.moneyQueries,
      people: () => ({
        queryKey: ['test', 'people'],
        queryFn: async () => [
          { id: 'u-ben', display_name: 'Ben Ortiz', avatar_path: null, deleted_at: null },
        ],
      }),
    },
    myProfileQueryOptions: () => ({
      queryKey: ['test', 'profile'],
      queryFn: async () => ({ id: VIEWER, display_name: 'Ava', default_currency: 'EUR' }),
    }),
  }
})

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

vi.mock('@/lib/realtime', () => ({
  useRealtime: () => undefined,
  useBatchedInvalidate: () => () => undefined,
  inFilter: () => undefined,
}))

describe('GroupsPage', () => {
  beforeEach(() => {
    api.groups = []
    api.deleted = []
  })

  it("shows each group with the viewer's balance and hides one-on-one tabs", async () => {
    api.groups = [
      group(),
      group({ id: 'g-flat', name: 'Roommates', emoji: '🏠', my_net_cents: 2500 }),
      group({ id: 'g-direct', name: 'Direct', is_direct: true }),
    ]
    renderWithProviders(<GroupsPage createOpen={false} onCreateOpenChange={() => {}} />, {
      path: '/groups',
    })

    expect(await screen.findByRole('heading', { name: 'Hike crew' })).toBeInTheDocument()
    expect(screen.getByText('you owe $60.51')).toBeInTheDocument()
    expect(screen.getByText('you are owed $25.00')).toBeInTheDocument()
    expect(screen.queryByText('Direct')).not.toBeInTheDocument()
  })

  it('tucks archived groups behind a toggle', async () => {
    api.groups = [
      group(),
      group({ id: 'g-old', name: 'Lisbon 2024', archived_at: '2026-01-01T00:00:00Z' }),
    ]
    renderWithProviders(<GroupsPage createOpen={false} onCreateOpenChange={() => {}} />, {
      path: '/groups',
    })

    const toggle = await screen.findByRole('button', { name: 'Show archived (1)' })
    expect(screen.queryByText('Lisbon 2024')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(screen.getByText('Lisbon 2024')).toBeInTheDocument()
  })

  it('invites the viewer to start a group when there are none', async () => {
    const onCreate = vi.fn()
    renderWithProviders(<GroupsPage createOpen={false} onCreateOpenChange={onCreate} />, {
      path: '/groups',
    })

    expect(await screen.findByText('A table for one?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create a group' }))
    expect(onCreate).toHaveBeenCalledWith(true)
  })

  it('shows a trip with its dates and a cover photo on its card', async () => {
    api.groups = [
      group({
        type: 'trip',
        starts_on: '2026-06-03',
        ends_on: '2026-06-10',
        cover_path: 'g-hike/cover.webp',
      }),
    ]
    const { container } = renderWithProviders(
      <GroupsPage createOpen={false} onCreateOpenChange={() => {}} />,
      { path: '/groups' },
    )
    expect(await screen.findByText('Jun 3 to Jun 10')).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('group-covers/g-hike/cover.webp'),
    )
  })

  it('lists recently deleted groups and restores one', async () => {
    const day = 24 * 60 * 60 * 1000
    api.deleted = [
      {
        id: 'g-old',
        name: 'Lisbon 2024',
        emoji: '🧳',
        color: 'sea',
        type: 'trip',
        cover_path: '',
        deleted_at: new Date(Date.now() - 18 * day).toISOString(),
        deleted_by: 'u-ben',
        purge_after: '',
        member_count: 3,
      },
      {
        id: 'g-older',
        name: 'Flat 2',
        emoji: '',
        color: '',
        type: 'home',
        cover_path: '',
        deleted_at: new Date(Date.now() - 30 * day + 60_000).toISOString(),
        deleted_by: VIEWER,
        purge_after: '',
        member_count: 2,
      },
    ]
    const { router } = renderWithProviders(
      <GroupsPage createOpen={false} onCreateOpenChange={() => {}} />,
      { path: '/groups' },
    )

    const toggle = await screen.findByRole('button', {
      name: t('groups.deleted.show', { count: 2 }),
    })
    expect(screen.queryByText('Lisbon 2024')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(screen.getByText('Lisbon 2024')).toBeInTheDocument()
    expect(await screen.findByText(/deleted by Ben/)).toBeInTheDocument()
    expect(screen.getByText(t('groups.deleted.daysLeft', { count: 12 }))).toBeInTheDocument()
    expect(screen.getByText(t('groups.deleted.lastDay'))).toBeInTheDocument()
    expect(screen.getByText(/deleted by you/)).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: t('groups.deleted.restoreLabel', { group: 'Lisbon 2024' }),
      }),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g-old'))
    expect(api.restoreGroup).toHaveBeenCalledWith(expect.anything(), 'g-old')
  })

  it('explains when a restore fails', async () => {
    api.deleted = [
      {
        id: 'g-gone',
        name: 'Gone',
        emoji: '',
        color: '',
        type: 'other',
        cover_path: '',
        deleted_at: new Date().toISOString(),
        deleted_by: 'u-ben',
        purge_after: '',
        member_count: 2,
      },
    ]
    api.restoreGroup.mockRejectedValueOnce({ message: 'group_not_found', code: 'PT404' })
    renderWithProviders(
      <>
        <GroupsPage createOpen={false} onCreateOpenChange={() => {}} />
        <Toaster label="Notifications" />
      </>,
      { path: '/groups' },
    )
    fireEvent.click(
      await screen.findByRole('button', { name: t('groups.deleted.show', { count: 1 }) }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: t('groups.deleted.restoreLabel', { group: 'Gone' }) }),
    )
    expect(await screen.findByText(t('errors.codes.group_not_found'))).toBeInTheDocument()
  })
})
