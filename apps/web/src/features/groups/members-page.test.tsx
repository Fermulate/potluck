import type * as ApiModule from '@potluck/api'
import type * as AuthModule from '@/lib/auth'
import type { GroupDetail } from '@potluck/api'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { group, member, VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { MembersPage } from './members-page'

const api = vi.hoisted(() => ({
  group: null as GroupDetail | null,
  removeMember: vi.fn(async () => undefined),
  setMemberRole: vi.fn(async () => undefined),
  leaveGroup: vi.fn(async () => undefined),
}))

vi.mock('@potluck/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return {
    ...actual,
    groupDetailQueryOptions: () => ({
      queryKey: ['test', 'group'],
      queryFn: async () => api.group,
    }),
    myGroupsQueryOptions: () => ({ queryKey: ['test', 'groups'], queryFn: async () => [] }),
    groupInvitesQueryOptions: () => ({ queryKey: ['test', 'invites'], queryFn: async () => [] }),
    myProfileQueryOptions: () => ({
      queryKey: ['test', 'profile'],
      queryFn: async () => ({ id: VIEWER, display_name: 'Ava', timezone: 'UTC' }),
    }),
    removeMember: api.removeMember,
    setMemberRole: api.setMemberRole,
    leaveGroup: api.leaveGroup,
  }
})

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

function rowFor(name: string) {
  return screen.getByText(name).closest('li') as HTMLElement
}

describe('MembersPage', () => {
  beforeEach(() => {
    api.group = group()
    vi.clearAllMocks()
  })

  it('lists people with roles and what they are owed or owe', async () => {
    renderWithProviders(<MembersPage groupId="g-hike" />)
    expect(await screen.findByText('Ava Chen (you)')).toBeInTheDocument()
    expect(within(rowFor('Ben Ortiz')).getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('owes $60.51')).toBeInTheDocument()
    expect(screen.getByText('is owed $47.50')).toBeInTheDocument()
  })

  it('puts the invite link on the page while the group is just you', async () => {
    api.group = group({ members: [member(VIEWER, 'Ava Chen', 'owner')] })
    renderWithProviders(<MembersPage groupId="g-hike" />)
    expect(await screen.findByRole('heading', { name: 'Just you so far' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Create link' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invite people' })).not.toBeInTheDocument()
  })

  it('keeps the invite behind a button once people have joined', async () => {
    renderWithProviders(<MembersPage groupId="g-hike" />)
    expect(await screen.findByRole('button', { name: 'Invite people' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Just you so far' })).not.toBeInTheDocument()
  })

  it('lets the owner remove a settled member after confirming', async () => {
    renderWithProviders(<MembersPage groupId="g-hike" />)
    await screen.findByText('Dev Patel')
    fireEvent.click(
      within(rowFor('Dev Patel')).getByRole('button', { name: 'Actions for Dev Patel' }),
    )
    fireEvent.click(await screen.findByRole('button', { name: /Remove from group/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove from group' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() =>
      expect(api.removeMember).toHaveBeenCalledWith(expect.anything(), 'g-hike', 'u-dev'),
    )
  })

  it('offers a closed account no role, only removal once settled', async () => {
    api.group = group({
      members: [
        member(VIEWER, 'Ava Chen', 'owner', -500),
        { ...member('u-eli', 'Eli Novak', 'member', 500), deleted_at: '2026-10-01T00:00:00Z' },
      ],
    })
    renderWithProviders(<MembersPage groupId="g-hike" />)
    await screen.findByText('Former member')
    fireEvent.click(
      within(rowFor('Former member')).getByRole('button', { name: 'Actions for Former member' }),
    )
    const remove = await screen.findByRole('button', { name: /Remove from group/ })
    expect(remove).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Make admin' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Make owner/ })).not.toBeInTheDocument()
  })

  it('lets the owner remove a settled closed account', async () => {
    api.group = group({
      members: [
        member(VIEWER, 'Ava Chen', 'owner', 0),
        { ...member('u-eli', 'Eli Novak', 'member', 0), deleted_at: '2026-10-01T00:00:00Z' },
      ],
    })
    renderWithProviders(<MembersPage groupId="g-hike" />)
    await screen.findByText('Former member')
    fireEvent.click(
      within(rowFor('Former member')).getByRole('button', { name: 'Actions for Former member' }),
    )
    const remove = await screen.findByRole('button', { name: /Remove from group/ })
    expect(remove).toBeEnabled()
    fireEvent.click(remove)
    const dialog = await screen.findByRole('dialog', { name: 'Remove from group' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() =>
      expect(api.removeMember).toHaveBeenCalledWith(expect.anything(), 'g-hike', 'u-eli'),
    )
  })

  it('will not remove someone who still has a balance', async () => {
    renderWithProviders(<MembersPage groupId="g-hike" />)
    await screen.findByText('Cleo Park')
    fireEvent.click(
      within(rowFor('Cleo Park')).getByRole('button', { name: 'Actions for Cleo Park' }),
    )
    const remove = await screen.findByRole('button', { name: /Remove from group/ })
    expect(remove).toBeDisabled()
    expect(remove).toHaveTextContent('Cleo Park still has an open balance. Settle up first.')
  })

  it('blocks leaving with an open balance and explains why', async () => {
    api.group = group({
      members: [member('u-ben', 'Ben Ortiz', 'owner'), member(VIEWER, 'Ava Chen', 'member', -500)],
    })
    renderWithProviders(<MembersPage groupId="g-hike" />)
    expect(await screen.findByRole('button', { name: 'Leave group' })).toBeDisabled()
    expect(
      screen.getByText('You still have an open balance here. Settle up first.'),
    ).toBeInTheDocument()
  })

  it('shows plain members no management controls', async () => {
    api.group = group({
      members: [member('u-ben', 'Ben Ortiz', 'owner'), member(VIEWER, 'Ava Chen', 'member')],
    })
    renderWithProviders(<MembersPage groupId="g-hike" />)
    await screen.findByText('Ben Ortiz')
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave group' })).toBeEnabled()
  })
})
