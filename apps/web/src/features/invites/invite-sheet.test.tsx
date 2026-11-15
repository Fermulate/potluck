import type * as ApiModule from '@potluck/api'
import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { encode } from 'uqr'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inviteUrl } from '@/lib/app-url'
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
  revokeInvite: vi.fn(async () => undefined),
  restoreInvite: vi.fn(async () => undefined),
}))

vi.mock('@potluck/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return {
    ...actual,
    groupInvitesQueryOptions: () => ({
      queryKey: ['test', 'invites'],
      queryFn: async () => api.open,
    }),
    myProfileQueryOptions: () => ({
      queryKey: ['test', 'profile'],
      queryFn: async () => ({ id: VIEWER, timezone: 'UTC' }),
    }),
    createInvite: api.createInvite,
    revokeInvite: api.revokeInvite,
    restoreInvite: api.restoreInvite,
  }
})

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

vi.mock('./share', () => ({ shareInvite: vi.fn(async () => undefined), copyText: vi.fn() }))

const link = {
  id: 'i-9',
  code: 'zzzzzzzzzz99',
  group_id: 'g-hike',
  role: 'member' as const,
  max_uses: null,
  uses: 0,
  expires_at: null,
  email: null,
  created_at: '2026-11-05T00:00:00Z',
  created_by: VIEWER,
  revoked_at: null,
}

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

  it('keeps Revoke apart from Copy, and offers Undo in its place after revoking', async () => {
    api.open = [link]
    renderWithProviders(<InvitePanel group={group()} />)
    const latest = await screen.findByRole('region', { name: 'Your link' })
    const copy = within(latest).getByRole('button', { name: 'Copy link' })
    const revoke = within(latest).getByRole('button', { name: t('invites.revoke') })
    // Not in the same row as Copy and Share.
    expect(copy.parentElement).not.toBe(revoke.parentElement)
    fireEvent.click(revoke)
    await waitFor(() => expect(api.revokeInvite).toHaveBeenCalledTimes(1))
    // Undo is in the panel itself (a sheet blocks the toast), with focus on it.
    const note = await screen.findByRole('status')
    expect(note).toHaveTextContent(t('invites.revoked'))
    const undo = within(note).getByRole('button', { name: t('common.undo') })
    expect(undo).toHaveFocus()
    fireEvent.click(undo)
    await waitFor(() => expect(api.restoreInvite).toHaveBeenCalledTimes(1))
    expect(api.restoreInvite.mock.calls[0]).toEqual([expect.anything(), 'i-9'])
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('offers Undo in a toast once the panel is gone', async () => {
    api.open = [link]
    render(<Toaster label="Notifications" />)
    const { router } = renderWithProviders(<InvitePanel group={group()} />)
    const latest = await screen.findByRole('region', { name: 'Your link' })
    fireEvent.click(within(latest).getByRole('button', { name: t('invites.revoke') }))
    await screen.findByRole('status')
    // One Undo while the panel is open: no toast behind a sheet.
    expect(screen.getAllByRole('button', { name: t('common.undo') })).toHaveLength(1)

    await act(() => router.navigate({ to: '/home' }))
    await screen.findByText('elsewhere')
    fireEvent.click(await screen.findByRole('button', { name: t('common.undo') }))
    await waitFor(() => expect(api.restoreInvite).toHaveBeenCalledTimes(1))
    expect(api.restoreInvite.mock.calls[0]).toEqual([expect.anything(), 'i-9'])
  })

  it('creates a member link in one tap, with sensible defaults', async () => {
    renderWithProviders(<InvitePanel group={group()} />)
    expect(await screen.findByText('Member link: anyone, expires in 7 days.')).toBeInTheDocument()
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

  it('shows the newest link as a QR code for someone across the table', async () => {
    api.open = [
      {
        id: 'i-9',
        code: 'zzzzzzzzzz99',
        group_id: 'g-hike',
        role: 'member',
        max_uses: null,
        uses: 0,
        expires_at: null,
        email: null,
        created_at: '2026-11-05T00:00:00Z',
        created_by: VIEWER,
        revoked_at: null,
      },
    ]
    renderWithProviders(<InvitePanel group={group()} />)
    const show = await screen.findByRole('button', { name: t('invites.qr.show') })
    expect(show).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(show)
    const qr = screen.getByRole('img', { name: t('invites.qr.label', { group: 'Hike crew' }) })
    // The drawn modules are a QR code of the invite's own link, at whichever error level.
    const drawn = [...(qr.querySelector('path')?.getAttribute('d') ?? '').matchAll(/M(\d+) (\d+)/g)]
      .map(([, x, y]) => `${x},${y}`)
      .sort()
    const modules = (ecc: 'L' | 'M' | 'Q' | 'H') => {
      const code = encode(inviteUrl('zzzzzzzzzz99'), { ecc, border: 0 })
      const n = code.size
      const eye = (x: number, y: number) =>
        [
          [0, 0],
          [n - 7, 0],
          [0, n - 7],
        ].some(([ex, ey]) => x >= ex! && x < ex! + 7 && y >= ey! && y < ey! + 7)
      return code.data
        .flatMap((row, y) => row.flatMap((dark, x) => (dark && !eye(x, y) ? [`${x},${y}`] : [])))
        .sort()
    }
    expect(drawn.length).toBeGreaterThan(0)
    expect((['L', 'M', 'Q', 'H'] as const).map(modules)).toContainEqual(drawn)
    expect(screen.getByText(t('invites.qr.hint'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('invites.qr.hide') }))
    expect(screen.queryByRole('img', { name: /QR code/ })).not.toBeInTheDocument()
  })
})
