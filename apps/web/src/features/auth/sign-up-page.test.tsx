import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HELP_PAGES } from '@/features/help/topics'
import { docsUrl } from '@/lib/docs'
import { renderWithProviders } from '@/test/render'
import { authCallsTo, resetDb, respondAuth } from '@/test/supabase'
import { SignUpPage } from './sign-up-page'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

function renderPage(redirect?: string) {
  return renderWithProviders(
    <>
      <SignUpPage redirect={redirect} />
      <Toaster label="Notifications" />
    </>,
    { path: '/sign-up' },
  )
}

async function submit(password = 'long enough') {
  fireEvent.change(await screen.findByRole('textbox', { name: t('auth.fields.name') }), {
    target: { value: '  Ava Chen ' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: t('auth.fields.email') }), {
    target: { value: 'ava@example.test' },
  })
  fireEvent.change(screen.getByLabelText(t('auth.fields.password')), {
    target: { value: password },
  })
  fireEvent.submit(screen.getByRole('button', { name: t('auth.signUp.submit') }).closest('form')!)
}

describe('SignUpPage', () => {
  beforeEach(() => {
    resetDb({ tables: { app_config: [] } })
  })

  it("links to the guide's privacy page in a new tab", async () => {
    renderPage()
    const link = await screen.findByRole('link', {
      name: `${t('auth.signUp.privacyLink')} (${t('help.newTab')})`,
    })
    expect(link).toHaveAttribute('href', docsUrl(HELP_PAGES.privacy))
    expect(link.getAttribute('href')).toMatch(/\/privacy-and-security\/$/)
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('creates the account and goes to onboarding when signed in straight away', async () => {
    respondAuth('signUp', { data: { session: { user: { id: 'u-new' } } } })
    const { router } = renderPage('/join/hikecrew-demo')
    await submit()

    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome'))
    expect(router.state.location.search).toEqual({ redirect: '/join/hikecrew-demo' })
    expect(authCallsTo('signUp')[0]![0]).toMatchObject({
      email: 'ava@example.test',
      password: 'long enough',
      options: { data: { display_name: 'Ava Chen', timezone: expect.any(String) } },
    })
  })

  it('asks to confirm the email when there is no session yet, and resends', async () => {
    respondAuth('signUp', { data: { session: null } })
    renderPage()
    await submit()

    expect(
      await screen.findByText(t('auth.checkEmail.body', { email: 'ava@example.test' })),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('auth.checkEmail.resend') }))
    expect(await screen.findByText(t('auth.checkEmail.resent'))).toBeInTheDocument()
    expect(authCallsTo('resend')[0]![0]).toMatchObject({
      type: 'signup',
      email: 'ava@example.test',
    })

    fireEvent.click(screen.getByRole('button', { name: t('auth.checkEmail.back') }))
    expect(await screen.findByRole('button', { name: t('auth.signUp.submit') })).toBeVisible()
  })

  it('says so when the resend fails', async () => {
    respondAuth('signUp', { data: { session: null } })
    respondAuth('resend', { error: { code: 'over_email_send_rate_limit', message: 'Slow down' } })
    renderPage()
    await submit()

    fireEvent.click(await screen.findByRole('button', { name: t('auth.checkEmail.resend') }))
    expect(await screen.findByText(t('errors.rateLimited'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('auth.checkEmail.resend') })).toBeEnabled()
  })

  it('refuses short passwords before calling the server', async () => {
    renderPage()
    await submit('short')
    expect(await screen.findByText(t('errors.auth.weakPassword'))).toBeInTheDocument()
    expect(authCallsTo('signUp')).toEqual([])
  })

  it('says when the email is already taken', async () => {
    respondAuth('signUp', { error: { code: 'user_already_exists', message: 'User exists' } })
    renderPage()
    await submit()
    expect(await screen.findByText(t('errors.auth.emailTaken'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('auth.signUp.signInLink') })).toHaveAttribute(
      'href',
      '/sign-in',
    )
  })
})
