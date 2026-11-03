import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { authCallsTo, resetDb, respondAuth, rowsOf } from '@/test/supabase'
import { OnboardingPage } from './onboarding-page'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

function seed() {
  resetDb({
    tables: {
      profiles: [
        {
          id: 'u-ava',
          display_name: 'ava',
          avatar_path: null,
          timezone: 'UTC',
          default_currency: 'USD',
        },
      ],
    },
  })
}

function renderPage(redirect = '/home') {
  return renderWithProviders(
    <>
      <OnboardingPage userId="u-ava" redirect={redirect} />
      <Toaster label="Notifications" />
    </>,
    { path: '/welcome' },
  )
}

async function saveProfile(name = '  Ava Chen ') {
  const field = await screen.findByRole('textbox', { name: t('onboarding.profile.nameLabel') })
  fireEvent.change(field, { target: { value: name } })
  fireEvent.change(screen.getByRole('combobox', { name: t('onboarding.profile.timezoneLabel') }), {
    target: { value: 'Asia/Tokyo' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: t('onboarding.profile.currencyLabel') }), {
    target: { value: 'JPY' },
  })
  fireEvent.click(screen.getByRole('button', { name: t('onboarding.profile.save') }))
}

describe('OnboardingPage', () => {
  beforeEach(seed)

  it('saves the profile, marks the account onboarded and moves to step two', async () => {
    renderPage()
    expect(await screen.findByText(t('onboarding.step', { step: 1, total: 2 }))).toBeVisible()
    await saveProfile()

    expect(
      await screen.findByRole('heading', { name: t('onboarding.firstGroup.title') }),
    ).toBeInTheDocument()
    expect(screen.getByText(t('onboarding.step', { step: 2, total: 2 }))).toBeVisible()
    expect(rowsOf('profiles')[0]).toMatchObject({
      display_name: 'Ava Chen',
      timezone: 'Asia/Tokyo',
      default_currency: 'JPY',
    })
    expect(authCallsTo('updateUser')).toEqual([[{ data: { onboarded: true } }]])
  })

  it('will not save without a name', async () => {
    renderPage()
    const field = await screen.findByRole('textbox', { name: t('onboarding.profile.nameLabel') })
    fireEvent.change(field, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: t('onboarding.profile.save') })).toBeDisabled()
  })

  it('stays on the form and explains when the account cannot be updated', async () => {
    respondAuth('updateUser', { error: { message: 'Network down' } })
    renderPage()
    await saveProfile()
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('onboarding.profile.save') })).toBeEnabled()
    expect(
      screen.queryByRole('heading', { name: t('onboarding.firstGroup.title') }),
    ).not.toBeInTheDocument()
  })

  it('goes straight to where the person was heading, without steps', async () => {
    const { router } = renderPage('/join/hikecrew-demo')
    await screen.findByRole('textbox', { name: t('onboarding.profile.nameLabel') })
    expect(screen.queryByText(t('onboarding.step', { step: 1, total: 2 }))).not.toBeInTheDocument()
    await saveProfile()
    await waitFor(() => expect(router.state.location.pathname).toBe('/join/hikecrew-demo'))
  })

  it('offers to create a group or skip', async () => {
    const { router } = renderPage()
    await saveProfile()
    fireEvent.click(await screen.findByRole('button', { name: t('onboarding.firstGroup.create') }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups'))
    expect(router.state.location.search).toEqual({ new: true })
  })

  it('skips to home', async () => {
    const { router } = renderPage()
    await saveProfile()
    fireEvent.click(await screen.findByRole('button', { name: t('onboarding.firstGroup.skip') }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
  })

  it('joins from a pasted invite link and rejects anything else', async () => {
    const { router } = renderPage()
    await saveProfile()
    fireEvent.click(await screen.findByRole('button', { name: t('onboarding.firstGroup.join') }))
    const link = screen.getByRole('textbox', { name: t('invites.linkLabel') })

    fireEvent.change(link, { target: { value: 'not a link' } })
    fireEvent.click(screen.getByRole('button', { name: t('common.continue') }))
    expect(await screen.findByText(t('invites.invalid.notFound'))).toBeInTheDocument()

    fireEvent.change(link, { target: { value: 'https://potluck.test/join/hikecrew-demo' } })
    fireEvent.click(screen.getByRole('button', { name: t('common.continue') }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/join/hikecrew-demo'))
  })
})
