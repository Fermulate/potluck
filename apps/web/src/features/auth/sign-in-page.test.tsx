import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { authCallsTo, resetDb, respondAuth } from '@/test/supabase'
import { SignInPage } from './sign-in-page'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

function renderPage(props: { redirect?: string; notice?: string } = {}) {
  return renderWithProviders(
    <>
      <SignInPage {...props} />
      <Toaster label="Notifications" />
    </>,
    { path: '/sign-in' },
  )
}

async function fill(email: string, password?: string) {
  fireEvent.change(await screen.findByRole('textbox', { name: t('auth.fields.email') }), {
    target: { value: email },
  })
  if (password !== undefined) {
    fireEvent.change(screen.getByLabelText(t('auth.fields.password')), {
      target: { value: password },
    })
  }
}

describe('SignInPage', () => {
  beforeEach(() => {
    resetDb({ tables: { app_config: [] } })
  })

  it('signs in with a password and goes where the person was heading', async () => {
    const { router } = renderPage({ redirect: '/groups/g-hike', notice: 'Sign in to join Hike' })
    expect(await screen.findByText('Sign in to join Hike')).toBeInTheDocument()
    await fill('ava@example.test', 'hunter22')
    fireEvent.click(screen.getByRole('button', { name: t('auth.signIn.submit') }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g-hike'))
    expect(authCallsTo('signInWithPassword')).toEqual([
      [{ email: 'ava@example.test', password: 'hunter22' }],
    ])
  })

  it('never redirects off site after signing in', async () => {
    const { router } = renderPage({ redirect: 'https://evil.example' })
    await fill('ava@example.test', 'hunter22')
    fireEvent.click(screen.getByRole('button', { name: t('auth.signIn.submit') }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
  })

  it('explains wrong credentials and stays put', async () => {
    respondAuth('signInWithPassword', { error: { code: 'invalid_credentials', message: 'x y' } })
    const { router } = renderPage()
    await fill('ava@example.test', 'nope')
    fireEvent.click(screen.getByRole('button', { name: t('auth.signIn.submit') }))
    expect(await screen.findByText(t('errors.auth.invalidCredentials'))).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/sign-in')
  })

  it('reveals the password on request', async () => {
    renderPage()
    await fill('ava@example.test', 'hunter22')
    const field = screen.getByLabelText(t('auth.fields.password'))
    expect(field).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: t('auth.fields.showPassword') }))
    expect(field).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: t('auth.fields.hidePassword') })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('sends a magic link, can resend it, and can go back', async () => {
    renderPage({ redirect: '/join/hikecrew-demo' })
    fireEvent.click(await screen.findByRole('button', { name: t('auth.signIn.magicLink') }))
    expect(screen.queryByLabelText(t('auth.fields.password'))).not.toBeInTheDocument()
    await fill('ava@example.test')
    fireEvent.click(screen.getAllByRole('button', { name: t('auth.signIn.magicLink') })[0]!)

    expect(
      await screen.findByText(t('auth.checkEmail.body', { email: 'ava@example.test' })),
    ).toBeInTheDocument()
    const [[otp]] = authCallsTo('signInWithOtp') as [[{ email: string; options: object }]]
    expect(otp).toMatchObject({
      email: 'ava@example.test',
      options: {
        emailRedirectTo: expect.stringMatching(
          /\/auth\/callback\?redirect=%2Fjoin%2Fhikecrew-demo$/,
        ),
        data: { timezone: expect.any(String) },
      },
    })

    fireEvent.click(screen.getByRole('button', { name: t('auth.checkEmail.resend') }))
    expect(await screen.findByText(t('auth.checkEmail.resent'))).toBeInTheDocument()
    expect(authCallsTo('signInWithOtp')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: t('auth.checkEmail.back') }))
    expect(await screen.findByRole('button', { name: t('auth.signIn.usePassword') })).toBeVisible()
  })

  it('offers Google and Apple when they are switched on', async () => {
    resetDb({
      tables: {
        app_config: [
          { key: 'google_auth', value: true },
          { key: 'apple_auth', value: true },
        ],
      },
    })
    renderPage({ redirect: '/plans' })
    fireEvent.click(await screen.findByRole('button', { name: t('auth.continueWithGoogle') }))
    await waitFor(() => expect(authCallsTo('signInWithOAuth')).toHaveLength(1))
    expect(authCallsTo('signInWithOAuth')[0]![0]).toMatchObject({
      provider: 'google',
      options: { redirectTo: expect.stringContaining('redirect=%2Fplans') },
    })

    respondAuth('signInWithOAuth', { error: { message: 'Server error' } })
    fireEvent.click(screen.getByRole('button', { name: t('auth.continueWithApple') }))
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument()
  })

  it('hides social sign in while the flags are off', async () => {
    renderPage()
    await screen.findByRole('textbox', { name: t('auth.fields.email') })
    expect(
      screen.queryByRole('button', { name: t('auth.continueWithGoogle') }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('auth.signIn.createAccount') })).toHaveAttribute(
      'href',
      '/sign-up',
    )
  })
})
