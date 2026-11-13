import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { authCallsTo, db, resetDb, respondAuth } from '@/test/supabase'
import { TwoFactorPage } from './two-factor-page'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
const signOut = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  signOut,
}))

const factor = { id: 'f1', factor_type: 'totp', status: 'verified' }

async function renderPage() {
  const view = renderWithProviders(
    <>
      <TwoFactorPage redirect="/groups/g1" />
      <Toaster label="Notifications" />
    </>,
    { path: '/two-factor' },
  )
  await screen.findByRole('heading', { name: t('security.challenge.title') })
  return view
}

beforeEach(() => {
  resetDb()
  respondAuth('mfa.listFactors', { data: { all: [factor] } })
})

describe('TwoFactorPage', () => {
  it('lets the right code through to where the person was going', async () => {
    const { router } = await renderPage()
    const verify = screen.getByRole('button', { name: t('security.challenge.submit') })
    expect(verify).toBeDisabled()
    fireEvent.change(screen.getByLabelText(t('security.twoFactor.code')), {
      target: { value: '123456' },
    })
    fireEvent.click(verify)
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    expect(authCallsTo('mfa.challengeAndVerify')).toEqual([[{ factorId: 'f1', code: '123456' }]])
  })

  it('refuses a wrong code and clears the box', async () => {
    respondAuth('mfa.challengeAndVerify', {
      error: { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' },
    })
    await renderPage()
    const box = screen.getByLabelText(t('security.twoFactor.code'))
    fireEvent.change(box, { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: t('security.challenge.submit') }))
    expect(
      await screen.findByText(t('security.errors.mfa_verification_failed')),
    ).toBeInTheDocument()
    expect(box).toHaveValue('')
    expect(box).toHaveAttribute('aria-invalid', 'true')
  })

  it('takes a recovery code, turns two-step off and refreshes the session', async () => {
    const { router } = await renderPage()
    fireEvent.click(screen.getByRole('button', { name: t('security.challenge.useRecovery') }))
    expect(screen.getByText(t('security.challenge.recoveryBody'))).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(t('security.challenge.recoveryCode')), {
      target: { value: 'abcde-23456' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('security.challenge.submit') }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    expect(db().calls).toContainEqual({
      kind: 'functions',
      name: 'mfa-recover',
      args: [{ method: 'POST', body: { code: 'abcde-23456' } }],
    })
    expect(authCallsTo('refreshSession')).toHaveLength(1)
  })

  it('says so when the recovery code is wrong', async () => {
    db().respond('functions:mfa-recover', {
      error: {
        message: 'non-2xx',
        context: { json: async () => ({ error: 'invalid_recovery_code' }) },
      },
    })
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: t('security.challenge.useRecovery') }))
    fireEvent.change(screen.getByLabelText(t('security.challenge.recoveryCode')), {
      target: { value: 'ZZZZZ-ZZZZZ' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('security.challenge.submit') }))
    expect(await screen.findByText(t('security.challenge.wrongRecovery'))).toBeInTheDocument()
    expect(authCallsTo('refreshSession')).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: t('security.challenge.useApp') }))
    expect(screen.getByLabelText(t('security.twoFactor.code'))).toBeInTheDocument()
  })

  it('can switch to another account', async () => {
    const { router } = await renderPage()
    fireEvent.click(screen.getByRole('button', { name: t('security.challenge.signOut') }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    expect(signOut).toHaveBeenCalled()
  })
})
