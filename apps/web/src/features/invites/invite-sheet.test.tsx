import type * as ApiModule from '@potluck/api'
import type * as AuthModule from '@/lib/auth'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { group, member, VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { InvitePanel } from './invite-sheet'

const api = vi.hoisted(() => ({
  open: [] as unknown[],
  createInvite: vi.fn(async () => ({
    id: 'i-1',
    code: 'abcdefghij12',
    group_id: 'g-hike',
    role: 'member' as const,
    max_uses: 5,
    uses: 0,
    expires_at: null,
    email: null,
    created_at: '2026-11-05T00:00:00Z',
    created_by: 'u-ava',
    revoked_at: null,
  })),
}))

vi.mock('@potluck/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return {
    ...actual,
    groupInvitesQueryOptions: () => ({ queryKey: ['test', 'invites'], queryFn: async () => api.open }),
    myProfileQueryOptions: () => ({
      queryKey: ['test', 'profile'],
      queryFn: async () => ({ id: VIEWER, timezone: 'UTC' }),
    }),
    createInvite: api.createInvite,
  }
})

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

vi.mock('./share', () => ({ shareInvite: vi.fn(async () => undefined), copyText: vi.fn() }))

describe('InvitePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.open = []
  })

  it('puts the newest open link up front, ready to copy', async () => {
    api.open = [
      {
        id: 'i-9',
        code: 'zzzzzzzzzz99',
        group_id: 'g-hike',
        role: 'member',
        max_uses: null,
        uses: 2,
        expires_at: null,
        email: null,
        created_at: '2026-11-05T00:00:00Z',
        created_by: VIEWER,
        revoked_at: null,
      },
    ]
    renderWithProviders(<InvitePanel group={group()} />)
    const latest = await screen.findByRole('region', { name: 'Your link' })
    expect(latest).toHaveTextContent('/join/zzzzzzzzzz99')
    expect(latest).toHaveTextContent('2 joined')
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New link' })).toBeInTheDocument()
  })

  it('creates a member link in one tap, with sensible defaults', async () => {
    renderWithProviders(<InvitePanel group={group()} />)
    expect(
      await screen.findByText('Member link: anyone, expires in 7 days.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: '5' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }))
    await waitFor(() => expect(api.createInvite).toHaveBeenCalled())
    const [, input] = api.createInvite.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ]
    expect(input).toMatchObject({ groupId: 'g-hike', role: 'member', maxUses: null })
    const days = (Date.parse(input.expiresAt as string) - Date.now()) / 86_400_000
    expect(Math.round(days)).toBe(7)
  })

  it('creates a link with the chosen uses and expiry', async () => {
    renderWithProviders(<InvitePanel group={group()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Link settings' }))
    fireEvent.click(screen.getByRole('radio', { name: '5' }))
    fireEvent.click(screen.getByRole('radio', { name: '30 days' }))
    expect(screen.getByText('Member link: up to 5 people, expires in 30 days.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }))
    await waitFor(() => expect(api.createInvite).toHaveBeenCalled())
    const [, input] = api.createInvite.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ]
    expect(input).toMatchObject({ groupId: 'g-hike', role: 'member', maxUses: 5 })
    const days = (Date.parse(input.expiresAt as string) - Date.now()) / 86_400_000
    expect(Math.round(days)).toBe(30)
  })

  it('only offers admin links to the owner', async () => {
    const { unmount } = renderWithProviders(<InvitePanel group={group()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Link settings' }))
    expect(screen.getByRole('radio', { name: 'Admin' })).toBeInTheDocument()
    unmount()

    renderWithProviders(
      <InvitePanel
        group={group({
          members: [member('u-ben', 'Ben', 'owner'), member(VIEWER, 'Ava', 'admin')],
        })}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Link settings' }))
    expect(screen.getByRole('radio', { name: '5' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Admin' })).not.toBeInTheDocument()
  })

  it('tells members when only admins can invite', async () => {
    renderWithProviders(
      <InvitePanel
        group={group({
          members_can_invite: false,
          members: [member('u-ben', 'Ben', 'owner'), member(VIEWER, 'Ava', 'member')],
        })}
      />,
    )
    expect(
      await screen.findByText('Only owners and admins can invite people to this group.'),
    ).toBeInTheDocument()
  })
})
