import type * as ApiModule from '@potluck/api'
import type * as AuthModule from '@/lib/auth'
import type { GroupDetail } from '@potluck/api'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { group, VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { GroupsPage } from './groups-page'

const api = vi.hoisted(() => ({ groups: [] as GroupDetail[] }))

vi.mock('@potluck/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return {
    ...actual,
    myGroupsQueryOptions: () => ({
      queryKey: ['test', 'groups'],
      queryFn: async () => api.groups,
    }),
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
})
