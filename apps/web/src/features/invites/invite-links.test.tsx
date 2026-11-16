import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { group, member, VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { db, resetDb, rowsOf } from '@/test/supabase'
import { InvitePanel } from './invite-sheet'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

function invite(id: string, patch: object = {}) {
  return {
    id,
    group_id: 'g-hike',
    code: `code-${id}-xyz`,
    role: 'member',
    max_uses: null,
    uses: 0,
    expires_at: null,
    email: null,
    revoked_at: null,
    created_at: '2026-11-01T00:00:00Z',
    created_by: VIEWER,
    ...patch,
  }
}

function renderPanel(
  g = group(),
  invites = [invite('i-1', { role: 'admin', max_uses: 5, uses: 2 })],
  inSheet = false,
) {
  resetDb({
    tables: {
      group_invites: invites,
      profiles: [{ id: VIEWER, display_name: 'Ava', timezone: 'UTC' }],
    },
  })
  return renderWithProviders(
    <>
      <InvitePanel group={g} inSheet={inSheet} />
      <Toaster label="Notifications" />
    </>,
  )
}

const latest = () => screen.getByRole('region', { name: t('invites.latest') })
const openLinks = () => screen.getByRole('region', { name: t('invites.active') })
const olderLink = (code: string) =>
  within(openLinks())
    .getAllByRole('listitem')
    .find((item) => item.textContent?.includes(`/join/${code}`))!

describe('InvitePanel links', () => {
  const writeText = vi.fn(async () => undefined)
  const twoLinks = [
    invite('i-1', { role: 'admin', max_uses: 5, uses: 2 }),
    invite('i-2', { expires_at: '2099-01-15T00:00:00Z' }),
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  })
  afterEach(() => {
    delete (navigator as { share?: unknown }).share
  })

  it('puts the newest link up front and lists the other open ones', async () => {
    renderPanel(group(), twoLinks)
    expect(await screen.findByRole('region', { name: t('invites.latest') })).toHaveTextContent(
      [
        t('invites.adminLink'),
        t('invites.usesLeft', { count: 3 }),
        t('invites.used', { count: 2 }),
      ].join(', '),
    )
    expect(latest()).toHaveTextContent('/join/code-i-1-xyz')
    expect(within(openLinks()).getAllByRole('listitem')).toHaveLength(1)
    expect(olderLink('code-i-2-xyz')).toHaveTextContent(t('invites.unlimited'))
    expect(olderLink('code-i-2-xyz')).toHaveTextContent(/Expires/)
    expect(screen.getByRole('button', { name: t('invites.newLink') })).toBeInTheDocument()
  })

  it('copies the newest link', async () => {
    renderPanel()
    await screen.findByRole('region', { name: t('invites.latest') })
    fireEvent.click(within(latest()).getByRole('button', { name: t('invites.copyLink') }))
    expect(await screen.findByText(t('invites.linkCopied'))).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/join\/code-i-1-xyz$/))
    expect(within(latest()).getByRole('button', { name: t('common.copied') })).toBeInTheDocument()
  })

  it('copies an older link from the list', async () => {
    renderPanel(group(), twoLinks)
    await screen.findByRole('region', { name: t('invites.active') })
    fireEvent.click(
      within(olderLink('code-i-2-xyz')).getByRole('button', { name: t('invites.copyLink') }),
    )
    expect(await screen.findByText(t('invites.linkCopied'))).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/join\/code-i-2-xyz$/))
    expect(
      within(olderLink('code-i-2-xyz')).getByRole('button', { name: t('common.copied') }),
    ).toBeInTheDocument()
  })

  it('shares through the native sheet when there is one', async () => {
    const share = vi.fn(async (_data: ShareData) => undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    renderPanel()
    await screen.findByRole('region', { name: t('invites.latest') })
    fireEvent.click(within(latest()).getByRole('button', { name: t('common.share') }))
    await waitFor(() => expect(share).toHaveBeenCalled())
    expect(share.mock.calls[0]![0]).toMatchObject({
      title: t('invites.shareTitle', { group: 'Hike crew' }),
      url: expect.stringMatching(/\/join\/code-i-1-xyz$/),
    })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to copying when sharing an older link fails', async () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn(async () => {
        throw new Error('nope')
      }),
    })
    renderPanel(group(), twoLinks)
    await screen.findByRole('region', { name: t('invites.active') })
    fireEvent.click(
      within(olderLink('code-i-2-xyz')).getByRole('button', { name: t('common.share') }),
    )
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/join\/code-i-2-xyz$/)),
    )
  })

  it('revokes the only link, and undo brings it back', async () => {
    renderPanel()
    await screen.findByRole('region', { name: t('invites.latest') })
    fireEvent.click(screen.getByRole('button', { name: t('invites.revoke') }))
    // In the link's place: what happened, and one Undo that already has focus.
    const note = await screen.findByRole('status')
    expect(note).toHaveTextContent(t('invites.revoked'))
    expect(rowsOf('group_invites')[0]!.revoked_at).toEqual(expect.any(String))
    expect(screen.queryByRole('region', { name: t('invites.latest') })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('invites.create') })).toBeInTheDocument()
    const undo = within(note).getByRole('button', { name: t('common.undo') })
    expect(undo).toHaveFocus()
    expect(screen.getAllByRole('button', { name: t('common.undo') })).toHaveLength(1)

    fireEvent.click(undo)
    expect(await screen.findByRole('region', { name: t('invites.latest') })).toHaveTextContent(
      '/join/code-i-1-xyz',
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await waitFor(() => expect(rowsOf('group_invites')[0]!.revoked_at).toBeNull())
  })

  it('revokes an older link, and undo puts it back in the list', async () => {
    renderPanel(group(), [invite('i-2', { created_at: '2026-11-03T00:00:00Z' }), invite('i-1')])
    await screen.findByRole('region', { name: t('invites.latest') })
    fireEvent.click(
      within(olderLink('code-i-1-xyz')).getByRole('button', {
        name: t('invites.revokeLink', { code: 'code-i-1-xyz' }),
      }),
    )
    const undo = await within(openLinks()).findByRole('button', { name: t('common.undo') })
    expect(undo).toHaveFocus()
    expect(within(openLinks()).queryByText(/code-i-1-xyz/)).not.toBeInTheDocument()
    // The newest link stays put.
    expect(latest()).toHaveTextContent('/join/code-i-2-xyz')

    fireEvent.click(undo)
    expect(await within(openLinks()).findByText(/code-i-1-xyz/)).toBeInTheDocument()
    await waitFor(() =>
      expect(rowsOf('group_invites').find((r) => r.id === 'i-1')!.revoked_at).toBeNull(),
    )
  })

  it('keeps an Undo for each of two quick revokes, focusing the newest', async () => {
    renderPanel(group(), [
      invite('i-3', { created_at: '2026-11-03T00:00:00Z' }),
      invite('i-2', { created_at: '2026-11-02T00:00:00Z' }),
      invite('i-1'),
    ])
    await screen.findByRole('region', { name: t('invites.latest') })
    fireEvent.click(within(latest()).getByRole('button', { name: t('invites.revoke') }))
    await waitFor(() => expect(latest()).toHaveTextContent('/join/code-i-2-xyz'))
    fireEvent.click(within(latest()).getByRole('button', { name: t('invites.revoke') }))
    await waitFor(() => expect(latest()).toHaveTextContent('/join/code-i-1-xyz'))

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: t('common.undo') })).toHaveLength(2),
    )
    const [forI3, forI2] = screen.getAllByRole('button', { name: t('common.undo') })
    expect(forI2).toHaveFocus()

    fireEvent.click(forI3!)
    await waitFor(() => expect(latest()).toHaveTextContent('/join/code-i-3-xyz'))
    await waitFor(() =>
      expect(rowsOf('group_invites').find((r) => r.id === 'i-3')!.revoked_at).toBeNull(),
    )
    expect(rowsOf('group_invites').find((r) => r.id === 'i-2')!.revoked_at).toEqual(
      expect.any(String),
    )
    expect(screen.getAllByRole('button', { name: t('common.undo') })).toHaveLength(1)
  })

  it('offers one toast Undo per link revoked before the sheet closed', async () => {
    render(<Toaster label="Notifications" />)
    const { router } = renderPanel(
      group(),
      [invite('i-2', { created_at: '2026-11-02T00:00:00Z' }), invite('i-1')],
      true,
    )
    await screen.findByRole('region', { name: t('invites.latest') })
    fireEvent.click(within(latest()).getByRole('button', { name: t('invites.revoke') }))
    await waitFor(() => expect(latest()).toHaveTextContent('/join/code-i-1-xyz'))
    fireEvent.click(within(latest()).getByRole('button', { name: t('invites.revoke') }))
    await waitFor(() => expect(screen.getAllByRole('status')).toHaveLength(2))

    await act(() => router.navigate({ to: '/home' }))
    await screen.findByText('elsewhere')
    const undos = await screen.findAllByRole('button', { name: t('common.undo') })
    expect(undos).toHaveLength(2)
    for (const undo of undos) fireEvent.click(undo)
    await waitFor(() =>
      expect(rowsOf('group_invites').map((r) => r.revoked_at)).toEqual([null, null]),
    )
  })

  it('keeps the link and explains when revoking fails', async () => {
    renderPanel()
    await screen.findByText(/code-i-1-xyz/)
    db().respond('from:group_invites', (call) =>
      call.kind === 'from' && call.ops.some((op) => op.method === 'update')
        ? { error: { message: 'Server error' } }
        : { data: [invite('i-1')] },
    )
    fireEvent.click(screen.getByRole('button', { name: t('invites.revoke') }))
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument()
    expect(screen.getByText(/code-i-1-xyz/)).toBeInTheDocument()
  })

  it('tells plain members when only admins may invite', async () => {
    renderPanel(
      group({
        members_can_invite: false,
        members: [member('u-ben', 'Ben Ortiz', 'owner'), member(VIEWER, 'Ava Chen')],
      }),
    )
    expect(await screen.findByText(t('invites.noPermission'))).toBeInTheDocument()
  })
})
