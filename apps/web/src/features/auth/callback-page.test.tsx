import { t } from '@potluck/i18n'
import { toast } from '@potluck/ui'
import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { authCallsTo, resetDb, respondAuth } from '@/test/supabase'
import { AuthCallbackPage } from './callback-page'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

const onboarded = { user: { id: 'u-ava', user_metadata: { onboarded: true } } }
const fresh = { user: { id: 'u-new', user_metadata: {} } }

function arriveAt(address: string, redirect?: string) {
  window.history.replaceState(null, '', address)
  return renderWithProviders(<AuthCallbackPage redirect={redirect} />, { path: '/auth/callback' })
}

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    resetDb()
    respondAuth('getSession', { data: { session: null } })
  })
  afterEach(() => window.history.replaceState(null, '', '/'))

  it('exchanges the code and sends an onboarded person on', async () => {
    respondAuth('exchangeCodeForSession', { data: { session: onboarded } })
    const { router } = arriveAt('/auth/callback?code=pkce-123', '/plans')
    await waitFor(() => expect(router.state.location.pathname).toBe('/plans'))
    expect(authCallsTo('exchangeCodeForSession')).toEqual([['pkce-123']])
  })

  it('sends new accounts through onboarding first', async () => {
    respondAuth('getSession', { data: { session: fresh } })
    const { router } = arriveAt('/auth/callback', '/join/hikecrew-demo')
    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome'))
    expect(router.state.location.search).toEqual({ redirect: '/join/hikecrew-demo' })
    expect(authCallsTo('exchangeCodeForSession')).toEqual([])
  })

  it('opens the reset form for a recovery link', async () => {
    respondAuth('getSession', { data: { session: fresh } })
    const { router } = arriveAt('/auth/callback#type=recovery&access_token=x')
    await waitFor(() => expect(router.state.location.pathname).toBe('/reset-password'))
  })

  it('shows progress while it works', async () => {
    respondAuth('getSession', () => new Promise(() => {}))
    arriveAt('/auth/callback')
    expect(await screen.findByRole('status', { name: t('common.loading') })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: t('auth.callback.working') })).toBeInTheDocument()
  })

  it.each([
    ['an error in the link', '/auth/callback?error=access_denied'],
    ['no session at all', '/auth/callback'],
  ])('shows a way back when there is %s', async (_case, address) => {
    arriveAt(address)
    expect(
      await screen.findByRole('heading', { name: t('auth.callback.failed') }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('auth.callback.tryAgain') })).toHaveAttribute(
      'href',
      '/sign-in',
    )
  })

  it('fails when the code cannot be exchanged', async () => {
    respondAuth('exchangeCodeForSession', { error: { code: 'otp_expired' } })
    arriveAt('/auth/callback?code=stale')
    expect(
      await screen.findByRole('heading', { name: t('auth.callback.failed') }),
    ).toBeInTheDocument()
  })

  it('says what is left after the first of two email change links', async () => {
    arriveAt(
      '/auth/callback#message=Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email',
      '/me',
    )
    expect(
      await screen.findByRole('heading', { name: t('security.email.halfConfirmed') }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('nav.me') })).toHaveAttribute('href', '/me')
    expect(authCallsTo('getSession')).toEqual([])
  })

  it('lands on Me with the new address after the second link', async () => {
    const moved = { user: { ...onboarded.user, email: 'ava@new.test' } }
    respondAuth('getSession', { data: { session: moved } })
    const success = vi.spyOn(toast, 'success')
    const { router } = arriveAt('/auth/callback#access_token=x&type=email_change', '/me')
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'))
    expect(success).toHaveBeenCalledWith(t('security.email.changed', { email: 'ava@new.test' }))
    success.mockRestore()
  })
})
