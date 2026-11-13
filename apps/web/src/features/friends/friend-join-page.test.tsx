import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { db, resetDb } from '@/test/supabase'
import { FriendJoinPage } from './friend-join-page'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; user_metadata: Record<string, unknown> } },
}))

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useSession: () => state.session,
}))

const preview = (patch: Record<string, unknown> = {}) => ({
  data: [
    { name: 'Ava', avatar_path: null, status: 'valid', is_friend: false, is_self: false, ...patch },
  ],
})

function renderPage() {
  return renderWithProviders(
    <>
      <FriendJoinPage code="ava-link-123" />
      <Toaster label="Notifications" />
    </>,
    { path: '/friend/ava-link-123' },
  )
}

describe('FriendJoinPage', () => {
  beforeEach(() => {
    state.session = null
    resetDb()
  })

  it('sends signed out visitors to sign up and back', async () => {
    db().respond('rpc:friend_invite_preview', preview())
    renderPage()
    expect(
      await screen.findByRole('heading', { name: t('people.friendJoin.title', { name: 'Ava' }) }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('people.friendJoin.signUp') })).toHaveAttribute(
      'href',
      '/sign-up?redirect=%2Ffriend%2Fava-link-123',
    )
  })

  it('becomes friends in one tap and opens their page', async () => {
    state.session = { user: { id: 'u-cleo', user_metadata: { onboarded: true } } }
    db()
      .respond('rpc:friend_invite_preview', preview())
      .respond('rpc:accept_friend_invite', { data: 'u-ava' })
    const { router } = renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: t('people.friendJoin.accept', { name: 'Ava' }) }),
    )
    expect(
      await screen.findByText(t('people.friendJoin.welcome', { name: 'Ava' })),
    ).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/friends/u-ava'))
    expect(db().rpcArgs('accept_friend_invite')).toEqual([{ code: 'ava-link-123' }])
  })

  it('says when you are already friends, or it is your own link', async () => {
    state.session = { user: { id: 'u-cleo', user_metadata: { onboarded: true } } }
    db().respond('rpc:friend_invite_preview', preview({ is_friend: true }))
    const first = renderPage()
    expect(
      await screen.findByText(t('people.friendJoin.already', { name: 'Ava' })),
    ).toBeInTheDocument()
    first.unmount()

    resetDb()
    db().respond('rpc:friend_invite_preview', preview({ is_self: true }))
    renderPage()
    expect(await screen.findByText(t('people.friendJoin.self'))).toBeInTheDocument()
  })

  it('explains a used or blocked link', async () => {
    db().respond('rpc:friend_invite_preview', preview({ status: 'used_up' }))
    const first = renderPage()
    expect(await screen.findByText(t('people.friendJoin.invalidTitle'))).toBeInTheDocument()
    expect(screen.getByText(t('invites.invalid.used'))).toBeInTheDocument()
    first.unmount()

    resetDb()
    db().respond('rpc:friend_invite_preview', preview({ status: 'blocked' }))
    renderPage()
    expect(await screen.findByText(t('errors.codes.blocked'))).toBeInTheDocument()
  })

  it('offers a retry when the link could not be loaded', async () => {
    db().respond('rpc:friend_invite_preview', { error: new TypeError('Failed to fetch') })
    renderPage()
    expect(await screen.findByRole('button', { name: t('common.retry') })).toBeInTheDocument()
  })

  it('tells why accepting failed', async () => {
    state.session = { user: { id: 'u-cleo', user_metadata: { onboarded: true } } }
    db()
      .respond('rpc:friend_invite_preview', preview())
      .respond('rpc:accept_friend_invite', { error: { message: 'invite_wrong_email' } })
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: t('people.friendJoin.accept', { name: 'Ava' }) }),
    )
    expect(await screen.findByText(t('errors.codes.invite_wrong_email'))).toBeInTheDocument()
  })
})
