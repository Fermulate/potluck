import { describe, expect, it } from 'vitest'
import {
  accountKeys,
  cancelEmailChange,
  clearRecoveryCodes,
  createRecoveryCodes,
  fetchRecoveryCodesLeft,
  recoverWithCode,
  recoveryCodesLeftQueryOptions,
} from './account'
import { fakeSupabase } from './testing/fake-supabase'

const boom = { message: 'mfa_required', code: '42501' }

describe('cancelEmailChange and clearRecoveryCodes', () => {
  it('posts to cancel-email-change and passes its code on', async () => {
    const fake = fakeSupabase()
    await cancelEmailChange(fake.client)
    expect(fake.calls).toEqual([
      { kind: 'functions', name: 'cancel-email-change', args: [{ method: 'POST', body: {} }] },
    ])
    const refused = fakeSupabase().respond('functions:cancel-email-change', {
      error: { message: 'non-2xx', context: { json: async () => ({ error: 'no_email_change' }) } },
    })
    await expect(cancelEmailChange(refused.client)).rejects.toThrow('no_email_change')
  })

  it('clears codes and reports how many went', async () => {
    const fake = fakeSupabase().respond(
      'rpc:clear_mfa_recovery_codes',
      { data: 10 },
      { data: null },
      { error: boom },
    )
    expect(await clearRecoveryCodes(fake.client)).toBe(10)
    expect(await clearRecoveryCodes(fake.client)).toBe(0)
    await expect(clearRecoveryCodes(fake.client)).rejects.toBe(boom)
  })
})

describe('recovery codes', () => {
  it('creates codes and counts what is left', async () => {
    const fake = fakeSupabase()
      .respond('rpc:create_mfa_recovery_codes', { data: ['ABCDE-23456'] }, { data: null })
      .respond('rpc:mfa_recovery_codes_left', { data: 7 }, { data: null })

    expect(await createRecoveryCodes(fake.client)).toEqual(['ABCDE-23456'])
    expect(await createRecoveryCodes(fake.client)).toEqual([])
    expect(await fetchRecoveryCodesLeft(fake.client)).toBe(7)
    expect(await fetchRecoveryCodesLeft(fake.client)).toBe(0)
  })

  it('passes errors through', async () => {
    const fake = fakeSupabase()
      .respond('rpc:create_mfa_recovery_codes', { error: boom })
      .respond('rpc:mfa_recovery_codes_left', { error: boom })
    await expect(createRecoveryCodes(fake.client)).rejects.toBe(boom)
    await expect(fetchRecoveryCodesLeft(fake.client)).rejects.toBe(boom)
  })

  it('keys the count per user', async () => {
    const fake = fakeSupabase().respond('rpc:mfa_recovery_codes_left', { data: 3 })
    const options = recoveryCodesLeftQueryOptions(fake.client, 'u1')
    expect(options.queryKey).toEqual(accountKeys.recoveryCodesLeft('u1'))
    expect(options.queryKey.slice(0, 2)).toEqual(accountKeys.all)
  })
})

describe('recoverWithCode', () => {
  it('posts the code to mfa-recover', async () => {
    const fake = fakeSupabase()
    await recoverWithCode(fake.client, 'abcde 23456')
    expect(fake.calls).toEqual([
      {
        kind: 'functions',
        name: 'mfa-recover',
        args: [{ method: 'POST', body: { code: 'abcde 23456' } }],
      },
    ])
  })

  it('turns the function answer into a stable code', async () => {
    const answer = { json: async () => ({ error: 'invalid_recovery_code' }) }
    const fake = fakeSupabase().respond('functions:mfa-recover', {
      error: { message: 'Edge Function returned a non-2xx status code', context: answer },
    })
    await expect(recoverWithCode(fake.client, 'x')).rejects.toThrow('invalid_recovery_code')
  })

  it('rethrows anything it cannot read', async () => {
    const network = { message: 'Failed to fetch' }
    const unreadable = {
      message: 'bad',
      context: { json: async () => Promise.reject(new Error('no body')) },
    }
    const fake = fakeSupabase().respond(
      'functions:mfa-recover',
      { error: network },
      { error: unreadable },
    )
    await expect(recoverWithCode(fake.client, 'x')).rejects.toBe(network)
    await expect(recoverWithCode(fake.client, 'x')).rejects.toBe(unreadable)
  })
})
