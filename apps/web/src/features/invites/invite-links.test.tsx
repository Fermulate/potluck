import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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
) {
  resetDb({
    tables: {
      group_invites: invites,
      profiles: [{ id: VIEWER, display_name: 'Ava', timezone: 'UTC' }],
    },
  })
  return renderWithProviders(
    <>
      <InvitePanel group={g} />
      <Toaster label="Notifications" />
    </>,
  )
}

const linkRow = (code: string) => screen.getByText(new RegExp(`/join/${code}$`)).closest('li')!

describe('InvitePanel links', () => {
  const writeText = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  })
  afterEach(() => {
    delete (navigator as { share?: unknown }).share
  })

  it('describes each open link', async () => {
    renderPanel(group(), [
      invite('i-1', { role: 'admin', max_uses: 5, uses: 2 }),
      invite('i-2', { expires_at: '2099-01-15T00:00:00Z' }),
    ])
    await screen.findByText(/code-i-1-xyz/)
    expect(linkRow('code-i-1-xyz')).toHaveTextContent(
      [
        t('invites.adminLink'),
        t('invites.usesLeft', { count: 3 }),
        t('invites.used', { count: 2 }),
      ].join(', '),
    )
    expect(linkRow('code-i-2-xyz')).toHaveTextContent(t('invites.unlimited'))
    expect(linkRow('code-i-2-xyz')).toHaveTextContent(/Expires/)
  })

  it('copies a link', async () => {
    renderPanel()
    await screen.findByText(/code-i-1-xyz/)
    fireEvent.click(
      within(linkRow('code-i-1-xyz')).getByRole('button', { name: t('invites.copyLink') }),
    )
    expect(await screen.findByText(t('invites.linkCopied'))).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/join\/code-i-1-xyz$/))
    expect(
      within(linkRow('code-i-1-xyz')).getByRole('button', { name: t('common.copied') }),
    ).toBeInTheDocument()
  })

  it('shares through the native sheet when there is one', async () => {
    const share = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    renderPanel()
    await screen.findByText(/code-i-1-xyz/)
    fireEvent.click(
      within(linkRow('code-i-1-xyz')).getByRole('button', { name: t('common.share') }),
    )
    await waitFor(() => expect(share).toHaveBeenCalled())
    expect(share.mock.calls[0]![0]).toMatchObject({
      title: t('invites.shareTitle', { group: 'Hike crew' }),
      url: expect.stringMatching(/\/join\/code-i-1-xyz$/),
    })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to copying when sharing fails', async () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn(async () => {
        throw new Error('nope')
      }),
    })
    renderPanel()
    await screen.findByText(/code-i-1-xyz/)
    fireEvent.click(
      within(linkRow('code-i-1-xyz')).getByRole('button', { name: t('common.share') }),
    )
    await waitFor(() => expect(writeText).toHaveBeenCalled())
  })

  it('revokes a link, and undo brings it back', async () => {
    renderPanel()
    await screen.findByText(/code-i-1-xyz/)
    fireEvent.click(
      screen.getByRole('button', { name: t('invites.revokeLink', { code: 'code-i-1-xyz' }) }),
    )
    expect(await screen.findByText(t('invites.revoked'))).toBeInTheDocument()
    expect(rowsOf('group_invites')[0]!.revoked_at).toEqual(expect.any(String))
    expect(await screen.findByText(t('invites.none'))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t('common.undo') }))
    expect(await screen.findByText(/code-i-1-xyz/)).toBeInTheDocument()
    expect(rowsOf('group_invites')[0]!.revoked_at).toBeNull()
  })

  it('keeps the link and explains when revoking fails', async () => {
    renderPanel()
    await screen.findByText(/code-i-1-xyz/)
    db().respond('from:group_invites', (call) =>
      call.kind === 'from' && call.ops.some((op) => op.method === 'update')
        ? { error: { message: 'Server error' } }
        : { data: [invite('i-1')] },
    )
    fireEvent.click(
      screen.getByRole('button', { name: t('invites.revokeLink', { code: 'code-i-1-xyz' }) }),
    )
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
