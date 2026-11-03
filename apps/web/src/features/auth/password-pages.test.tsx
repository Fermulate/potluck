import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { authCallsTo, resetDb, respondAuth } from '@/test/supabase'
import { ForgotPasswordPage, ResetPasswordPage } from './password-pages'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

const auth = vi.hoisted(() => ({ session: null as null | { user: { id: string } } }))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useSession: () => auth.session,
}))

function withToaster(ui: React.ReactNode) {
  return (
    <>
      {ui}
      <Toaster label="Notifications" />
    </>
  )
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => resetDb())

  it('sends a reset link that comes back to the reset form', async () => {
    renderWithProviders(withToaster(<ForgotPasswordPage initialEmail="ava@example.test" />))
    const email = await screen.findByRole('textbox', { name: t('auth.fields.email') })
    expect(email).toHaveValue('ava@example.test')
    fireEvent.click(screen.getByRole('button', { name: t('auth.forgotPassword.submit') }))

    expect(await screen.findByRole('status')).toHaveTextContent(t('auth.forgotPassword.sent'))
    const [[address, options]] = authCallsTo('resetPasswordForEmail') as [
      [string, { redirectTo: string }],
    ]
    expect(address).toBe('ava@example.test')
    expect(options.redirectTo).toMatch(/\/auth\/callback\?redirect=%2Freset-password$/)
    expect(screen.getByRole('link', { name: t('auth.forgotPassword.back') })).toHaveAttribute(
      'href',
      '/sign-in',
    )
  })

  it('explains rate limits', async () => {
    respondAuth('resetPasswordForEmail', { error: { code: 'over_email_send_rate_limit' } })
    renderWithProviders(withToaster(<ForgotPasswordPage />))
    fireEvent.change(await screen.findByRole('textbox', { name: t('auth.fields.email') }), {
      target: { value: 'ava@example.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('auth.forgotPassword.submit') }))
    expect(await screen.findByText(t('errors.rateLimited'))).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    resetDb()
    auth.session = { user: { id: 'u-ava' } }
  })

  function setPassword(value: string) {
    fireEvent.change(screen.getByLabelText(t('auth.fields.newPassword')), { target: { value } })
    fireEvent.submit(
      screen.getByRole('button', { name: t('auth.resetPassword.submit') }).closest('form')!,
    )
  }

  it('says the link expired when there is no recovery session', async () => {
    auth.session = null
    renderWithProviders(<ResetPasswordPage />)
    expect(await screen.findByText(t('auth.resetPassword.expired'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('auth.forgotPassword.submit') })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })

  it('updates the password and heads home', async () => {
    const { router } = renderWithProviders(<ResetPasswordPage />, { path: '/reset-password' })
    await screen.findByLabelText(t('auth.fields.newPassword'))
    setPassword('a brand new one')
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
    expect(authCallsTo('updateUser')).toEqual([[{ password: 'a brand new one' }]])
  })

  it('refuses a short password, and reports a server refusal', async () => {
    renderWithProviders(withToaster(<ResetPasswordPage />), { path: '/reset-password' })
    await screen.findByLabelText(t('auth.fields.newPassword'))
    setPassword('short')
    expect(await screen.findByText(t('errors.auth.weakPassword'))).toBeInTheDocument()
    expect(authCallsTo('updateUser')).toEqual([])

    respondAuth('updateUser', { error: { message: 'Server error' } })
    setPassword('long enough now')
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument()
  })
})
