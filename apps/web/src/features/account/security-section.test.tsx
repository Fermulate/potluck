import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { authCallsTo, db, resetDb, respondAuth } from '@/test/supabase'
import { SecuritySection } from './security-section'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

const auth = vi.hoisted(() => ({
  user: {} as Record<string, unknown>,
  signOut: vi.fn(async (_scope?: string) => undefined),
}))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => 'u-ava',
  useSession: () => ({ user: auth.user }),
  signOut: auth.signOut,
}))

const verified = {
  id: 'f1',
  factor_type: 'totp',
  status: 'verified',
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-02T10:00:00Z',
}

function setup({ factors = [] as object[], user = {} as Record<string, unknown> } = {}) {
  auth.user = {
    id: 'u-ava',
    email: 'ava@example.test',
    identities: [{ provider: 'email' }],
    user_metadata: {},
    ...user,
  }
  const fake = resetDb({ tables: { profiles: [{ id: 'u-ava', timezone: 'UTC' }] } })
  respondAuth('mfa.listFactors', { data: { all: factors } })
  return fake
}

async function renderSection() {
  const view = renderWithProviders(
    <>
      <SecuritySection />
      <Toaster label="Notifications" />
    </>,
    { path: '/me' },
  )
  await screen.findByText(t('security.email.label'))
  return view
}

const dialog = () => screen.getByRole('dialog')

describe('email', () => {
  beforeEach(() => setup())

  it('sends confirmation links for a new address', async () => {
    await renderSection()
    expect(screen.getByText('ava@example.test')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('security.email.change') }))
    const field = within(dialog()).getByRole('textbox', { name: t('security.email.newEmail') })

    fireEvent.change(field, { target: { value: 'AVA@example.test' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: t('security.email.submit') }))
    expect(await within(dialog()).findByText(t('security.email.same'))).toBeInTheDocument()
    expect(authCallsTo('updateUser')).toEqual([])

    fireEvent.change(field, { target: { value: 'ava@new.test' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: t('security.email.submit') }))
    expect(await screen.findByText(t('security.email.sent'))).toBeInTheDocument()
    expect(authCallsTo('updateUser')[0]?.[0]).toEqual({ email: 'ava@new.test' })
  })

  it('shows a change that is waiting for confirmation', async () => {
    setup({ user: { new_email: 'ava@new.test' } })
    await renderSection()
    expect(screen.getByRole('status')).toHaveTextContent(
      t('security.email.pending', { email: 'ava@new.test' }),
    )
    fireEvent.click(screen.getByRole('button', { name: t('security.email.cancel') }))
    expect(
      await screen.findByText(t('security.email.cancelled', { email: 'ava@example.test' })),
    ).toBeInTheDocument()
    expect(db().calls.some((c) => c.kind === 'functions' && c.name === 'cancel-email-change')).toBe(
      true,
    )
    expect(authCallsTo('refreshSession')).toHaveLength(1)
  })

  it('explains a refused address in the dialog', async () => {
    respondAuth('updateUser', {
      error: { code: 'email_exists', message: 'Email address already registered' },
    })
    await renderSection()
    fireEvent.click(screen.getByRole('button', { name: t('security.email.change') }))
    fireEvent.change(within(dialog()).getByRole('textbox'), { target: { value: 'b@b.test' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: t('security.email.submit') }))
    expect(await within(dialog()).findByText(t('errors.auth.emailTaken'))).toBeInTheDocument()
  })
})

describe('password', () => {
  beforeEach(() => setup())

  function fill(current: string, next: string, again: string) {
    const d = dialog()
    fireEvent.change(within(d).getByLabelText(t('security.password.current')), {
      target: { value: current },
    })
    fireEvent.change(within(d).getByLabelText(t('security.password.next')), {
      target: { value: next },
    })
    fireEvent.change(within(d).getByLabelText(t('security.password.confirm')), {
      target: { value: again },
    })
    fireEvent.click(within(d).getByRole('button', { name: t('security.password.submit') }))
  }

  it('checks length and the repeat before asking the server', async () => {
    await renderSection()
    fireEvent.click(screen.getByRole('button', { name: t('security.password.change') }))
    fill('old-pass', 'short', 'short')
    expect(await within(dialog()).findByText(t('errors.auth.weakPassword'))).toBeInTheDocument()
    fill('old-pass', 'new-pass-1', 'new-pass-2')
    expect(await within(dialog()).findByText(t('security.password.mismatch'))).toBeInTheDocument()
    expect(authCallsTo('updateUser')).toEqual([])
  })

  it('marks a wrong current password on its field', async () => {
    respondAuth('isolated.signInWithPassword', { error: { code: 'invalid_credentials' } })
    await renderSection()
    fireEvent.click(screen.getByRole('button', { name: t('security.password.change') }))
    fill('nope', 'new-pass-1', 'new-pass-1')
    expect(
      await within(dialog()).findByText(t('security.password.wrongCurrent')),
    ).toBeInTheDocument()
    expect(within(dialog()).getByLabelText(t('security.password.current'))).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  it('saves and signs out the other devices', async () => {
    await renderSection()
    fireEvent.click(screen.getByRole('button', { name: t('security.password.change') }))
    expect(
      within(dialog()).getByRole('link', { name: t('security.password.forgot') }),
    ).toHaveAttribute('href', '/forgot-password?email=ava%40example.test')
    fill('old-pass', 'new-pass-1', 'new-pass-1')
    expect(await screen.findByText(t('security.password.saved'))).toBeInTheDocument()
    expect(authCallsTo('signOut')).toEqual([[{ scope: 'others' }]])
  })

  it('asks for an emailed code when the session is too old to change it', async () => {
    let tries = 0
    respondAuth('updateUser', async () => {
      tries += 1
      return tries === 1
        ? {
            data: {},
            error: {
              code: 'reauthentication_needed',
              message: 'Password update requires reauthentication',
            },
          }
        : tries === 2
          ? {
              data: {},
              error: {
                code: 'reauthentication_not_valid',
                message: 'Verification code is invalid',
              },
            }
          : { data: {}, error: null }
    })
    await renderSection()
    fireEvent.click(screen.getByRole('button', { name: t('security.password.change') }))
    fill('old-pass', 'new-pass-1', 'new-pass-1')

    const code = await within(dialog()).findByLabelText(t('security.password.reauthCode'))
    expect(authCallsTo('reauthenticate')).toHaveLength(1)
    const submit = within(dialog()).getByRole('button', { name: t('security.password.submit') })
    expect(submit).toBeDisabled()
    fireEvent.change(code, { target: { value: '111111' } })
    fireEvent.click(submit)
    expect(
      await within(dialog()).findByText(t('security.errors.reauthentication_not_valid')),
    ).toBeInTheDocument()

    fireEvent.change(code, { target: { value: '222222' } })
    fireEvent.click(submit)
    expect(await screen.findByText(t('security.password.saved'))).toBeInTheDocument()
    expect(authCallsTo('updateUser').at(-1)?.[0]).toMatchObject({ nonce: '222222' })
    expect(authCallsTo('reauthenticate')).toHaveLength(1)
  })

  it('lets a Google only account set a first password', async () => {
    setup({ user: { identities: [{ provider: 'google' }] } })
    await renderSection()
    expect(screen.getByText(t('security.password.setHint'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('security.password.set') }))
    expect(within(dialog()).queryByLabelText(t('security.password.current'))).toBeNull()
    fireEvent.change(within(dialog()).getByLabelText(t('security.password.next')), {
      target: { value: 'first-pass' },
    })
    fireEvent.change(within(dialog()).getByLabelText(t('security.password.confirm')), {
      target: { value: 'first-pass' },
    })
    fireEvent.click(within(dialog()).getByRole('button', { name: t('security.password.submit') }))
    expect(await screen.findByText(t('security.password.saved'))).toBeInTheDocument()
    expect(authCallsTo('isolated.signInWithPassword')).toEqual([])
  })
})

describe('two-step sign in', () => {
  it('sets up with a QR code, a first code and recovery codes', async () => {
    setup()
    respondAuth('mfa.enroll', {
      data: {
        id: 'f9',
        totp: { qr_code: 'data:image/svg+xml;utf8,<svg/>', secret: 'JBSWY3DPEHPK3PXP' },
      },
    })
    db().respond('rpc:create_mfa_recovery_codes', { data: ['AAAAA-22222', 'BBBBB-33333'] })
    await renderSection()

    fireEvent.click(await screen.findByRole('button', { name: t('security.twoFactor.enable') }))
    expect(
      await within(dialog()).findByRole('img', { name: t('security.twoFactor.setup.qr') }),
    ).toBeInTheDocument()
    expect(within(dialog()).getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument()

    const submit = within(dialog()).getByRole('button', {
      name: t('security.twoFactor.setup.submit'),
    })
    const code = within(dialog()).getByLabelText(t('security.twoFactor.code'))
    fireEvent.change(code, { target: { value: '12a34' } })
    expect(code).toHaveValue('1234')
    expect(submit).toBeDisabled()

    respondAuth('mfa.challengeAndVerify', { error: { code: 'mfa_verification_failed' } })
    fireEvent.change(code, { target: { value: '000000' } })
    fireEvent.click(submit)
    expect(
      await within(dialog()).findByText(t('security.errors.mfa_verification_failed')),
    ).toBeInTheDocument()

    respondAuth('mfa.challengeAndVerify', { data: {} })
    respondAuth('mfa.listFactors', { data: { all: [verified] } })
    fireEvent.change(code, { target: { value: '123456' } })
    fireEvent.click(submit)

    const codes = await within(dialog()).findByRole('list', {
      name: t('security.twoFactor.recovery.title'),
    })
    expect(
      within(codes)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['AAAAA-22222', 'BBBBB-33333'])
    expect(authCallsTo('mfa.challengeAndVerify').at(-1)).toEqual([
      { factorId: 'f9', code: '123456' },
    ])
    // Shown once, so the only way out is saying they are saved.
    expect(within(dialog()).queryByRole('button', { name: t('common.close') })).toBeNull()
    fireEvent.keyDown(dialog(), { key: 'Escape' })
    expect(within(dialog()).getByRole('list')).toBeInTheDocument()
    fireEvent.click(
      within(dialog()).getByRole('button', { name: t('security.twoFactor.recovery.done') }),
    )
    expect(
      await screen.findByRole('button', { name: t('security.twoFactor.disable') }),
    ).toBeInTheDocument()
  })

  it('shows the count of codes left, replaces them and turns off with a code', async () => {
    setup({ factors: [verified] })
    db()
      .respond('rpc:mfa_recovery_codes_left', { data: 7 })
      .respond('rpc:create_mfa_recovery_codes', { data: ['CCCCC-44444'] })
    await renderSection()

    expect(
      await screen.findByText(t('security.twoFactor.recovery.left', { count: 7 }), {
        exact: false,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(t('security.twoFactor.on'))).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: t('security.twoFactor.recovery.regenerate') }),
    )
    fireEvent.click(
      within(dialog()).getByRole('button', { name: t('security.twoFactor.recovery.regenerate') }),
    )
    expect(await screen.findByText('CCCCC-44444')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('security.twoFactor.recovery.done') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: t('security.twoFactor.disable') }))
    fireEvent.change(within(dialog()).getByLabelText(t('security.twoFactor.code')), {
      target: { value: '654321' },
    })
    respondAuth('mfa.listFactors', { data: { all: [] } })
    fireEvent.click(within(dialog()).getByRole('button', { name: t('security.twoFactor.disable') }))
    expect(await screen.findByText(t('security.twoFactor.disabled'))).toBeInTheDocument()
    expect(authCallsTo('mfa.unenroll')).toEqual([[{ factorId: 'f1' }]])
    expect(db().rpcArgs('clear_mfa_recovery_codes')).toHaveLength(1)
  })
})

describe('devices', () => {
  beforeEach(() => {
    setup()
    auth.signOut.mockClear()
  })

  it('signs out everywhere after asking', async () => {
    const { router } = await renderSection()
    fireEvent.click(screen.getByRole('button', { name: t('security.sessions.signOutAll') }))
    expect(within(dialog()).getByText(t('security.sessions.confirmBody'))).toBeInTheDocument()
    fireEvent.click(
      within(dialog()).getByRole('button', { name: t('security.sessions.signOutAll') }),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    expect(auth.signOut).toHaveBeenCalledWith('global')
  })

  it('stays put and says so when it fails', async () => {
    auth.signOut.mockRejectedValueOnce({ code: 'over_request_rate_limit' })
    await renderSection()
    fireEvent.click(screen.getByRole('button', { name: t('security.sessions.signOutAll') }))
    fireEvent.click(
      within(dialog()).getByRole('button', { name: t('security.sessions.signOutAll') }),
    )
    expect(await screen.findByText(t('errors.rateLimited'))).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
