import { t } from '@potluck/i18n'
import type { User } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authCallsTo, resetDb, respondAuth } from '@/test/supabase'
import { accountError } from './account-error'
import {
  changeEmail,
  changePassword,
  disableTotp,
  hasPassword,
  startTotp,
  verifiedTotp,
} from './actions'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

const factor = (id: string, status: 'verified' | 'unverified') => ({
  id,
  factor_type: 'totp',
  status,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-02T00:00:00Z',
})

beforeEach(() => resetDb())

describe('hasPassword', () => {
  const user = (providers: string[], metadata: object = {}) =>
    ({
      identities: providers.map((provider) => ({ provider })),
      user_metadata: metadata,
    }) as unknown as User

  it('is true for email accounts and for anyone who set one', () => {
    expect(hasPassword(user(['email']))).toBe(true)
    expect(hasPassword(user(['google'], { has_password: true }))).toBe(true)
  })

  it('is false for accounts that only ever used Google or Apple', () => {
    expect(hasPassword(user(['google', 'apple']))).toBe(false)
    expect(hasPassword({ user_metadata: {} } as unknown as User)).toBe(false)
  })
})

describe('authenticator factors', () => {
  it('finds the verified authenticator', async () => {
    respondAuth('mfa.listFactors', {
      data: { all: [factor('f1', 'unverified'), factor('f2', 'verified')] },
    })
    expect((await verifiedTotp())?.id).toBe('f2')
    respondAuth('mfa.listFactors', { data: { all: [] } })
    expect(await verifiedTotp()).toBeNull()
  })

  it('clears an unfinished setup before starting a new one', async () => {
    respondAuth('mfa.listFactors', {
      data: { all: [factor('old', 'unverified'), factor('kept', 'verified')] },
    })
    respondAuth('mfa.enroll', {
      data: { id: 'new', totp: { qr_code: 'data:image/svg+xml;x', secret: 'ABC', uri: 'otpauth' } },
    })
    expect(await startTotp()).toEqual({
      factorId: 'new',
      qrCode: 'data:image/svg+xml;x',
      secret: 'ABC',
    })
    expect(authCallsTo('mfa.unenroll')).toEqual([[{ factorId: 'old' }]])
    expect(authCallsTo('mfa.enroll')[0]?.[0]).toMatchObject({ factorType: 'totp' })
  })

  it('turns it off only after a good code', async () => {
    await disableTotp('f2', ' 123456 ')
    expect(authCallsTo('mfa.challengeAndVerify')).toEqual([[{ factorId: 'f2', code: '123456' }]])
    expect(authCallsTo('mfa.unenroll')).toEqual([[{ factorId: 'f2' }]])

    resetDb()
    const wrong = { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' }
    respondAuth('mfa.challengeAndVerify', { error: wrong })
    await expect(disableTotp('f2', '000000')).rejects.toBe(wrong)
    expect(authCallsTo('mfa.unenroll')).toEqual([])
    expect(accountError(wrong)).toBe(t('security.errors.mfa_verification_failed'))
  })
})

describe('changeEmail', () => {
  it('asks Supabase to confirm the new address and come back to Me', async () => {
    await changeEmail('  new@example.test ')
    const [[attributes, options]] = authCallsTo('updateUser') as [
      [object, { emailRedirectTo: string }],
    ]
    expect(attributes).toEqual({ email: 'new@example.test' })
    expect(options.emailRedirectTo).toMatch(/\/auth\/callback\?redirect=%2Fme$/)
  })

  it('passes errors on', async () => {
    const taken = { code: 'email_exists', message: 'taken' }
    respondAuth('updateUser', { error: taken })
    await expect(changeEmail('a@b.c')).rejects.toBe(taken)
  })
})

describe('changePassword', () => {
  it('checks the current password on the side, then signs out every other device', async () => {
    await changePassword({ email: 'ava@example.test', current: 'old-pass', next: 'new-pass-1' })
    expect(authCallsTo('isolated.signInWithPassword')).toEqual([
      [{ email: 'ava@example.test', password: 'old-pass' }],
    ])
    expect(authCallsTo('isolated.signOut')).toEqual([[{ scope: 'local' }]])
    expect(authCallsTo('updateUser')).toEqual([
      [{ password: 'new-pass-1', data: { has_password: true } }],
    ])
    expect(authCallsTo('signOut')).toEqual([[{ scope: 'others' }]])
  })

  it('refuses a wrong current password without touching the account', async () => {
    respondAuth('isolated.signInWithPassword', {
      error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    })
    const failure = await changePassword({
      email: 'a@b.c',
      current: 'x',
      next: 'new-pass-1',
    }).catch((e: unknown) => e)
    expect(accountError(failure)).toBe(t('security.password.wrongCurrent'))
    expect(authCallsTo('updateUser')).toEqual([])
  })

  it('passes other sign in failures on as they are', async () => {
    const limited = { code: 'over_request_rate_limit', message: 'slow down' }
    respondAuth('isolated.signInWithPassword', { error: limited })
    await expect(changePassword({ email: 'a@b.c', current: 'x', next: 'y' })).rejects.toBe(limited)
  })

  it('sets a first password without asking for one', async () => {
    await changePassword({ email: 'a@b.c', next: 'new-pass-1' })
    expect(authCallsTo('isolated.signInWithPassword')).toEqual([])
    expect(authCallsTo('updateUser')).toHaveLength(1)
  })

  it('reports a refused update and a failed sign out of other devices', async () => {
    const same = { code: 'same_password', message: 'same' }
    respondAuth('updateUser', { error: same })
    await expect(changePassword({ email: 'a@b.c', next: 'p' })).rejects.toBe(same)

    resetDb()
    const down = { code: 'unexpected_failure', message: 'down' }
    respondAuth('signOut', { error: down })
    await expect(changePassword({ email: 'a@b.c', next: 'p' })).rejects.toBe(down)
  })

  it('surfaces factor list and enrol failures', async () => {
    const down = { code: 'unexpected_failure', message: 'down' }
    respondAuth('mfa.listFactors', { error: down })
    await expect(verifiedTotp()).rejects.toBe(down)
    await expect(startTotp()).rejects.toBe(down)
  })
})
