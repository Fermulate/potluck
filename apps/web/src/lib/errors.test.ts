import { PlanError } from '@potluck/api'
import { t } from '@potluck/i18n'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { errorMessage } from './errors'

/** A client whose every request fails the way the browser reports an unreachable host. */
function unreachable(wording: string) {
  return createClient('http://supabase.test', 'publishable-key', {
    global: { fetch: () => Promise.reject(new TypeError(wording)) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

describe('errorMessage', () => {
  it('translates stable RPC codes carried in message', () => {
    expect(errorMessage({ message: 'member_has_balance', details: 'English text' })).toBe(
      'They still have an open balance here. Settle up first.',
    )
  })

  it('explains why a group with open balances cannot be deleted', () => {
    expect(errorMessage({ message: 'group_has_balances', code: '23514' })).toBe(
      'Someone still owes money here. Settle every balance before deleting the group.',
    )
  })

  it('translates auth error codes', () => {
    expect(
      errorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' }),
    ).toBe('That email and password do not match.')
  })

  it('falls back to a friendly generic line', () => {
    expect(errorMessage(new Error('Something exploded'))).toBe(
      'Something burned in the kitchen. Try again?',
    )
    expect(errorMessage({ message: 'some_unknown_code' })).toBe(
      'Something burned in the kitchen. Try again?',
    )
  })

  it('prefers the screen wording for a code, then the shared one', () => {
    const notAllowed = { message: 'not_allowed' }
    expect(errorMessage(notAllowed, 'expenses.errors')).toBe(t('expenses.errors.not_allowed'))
    expect(errorMessage(notAllowed)).toBe(t('errors.codes.not_allowed'))
    // No plans wording for this one, so the general line is used.
    expect(errorMessage({ message: 'member_has_balance' }, 'events.errors')).toBe(
      t('errors.codes.member_has_balance'),
    )
  })

  it('reads plan error codes even with details attached', () => {
    expect(errorMessage(new PlanError('event_not_found', 'gone'), 'events.errors')).toBe(
      t('events.errors.event_not_found'),
    )
  })

  it('says offline when the request never got an answer', () => {
    expect(errorMessage(new TypeError('Failed to fetch'), 'events.errors')).toBe(
      t('errors.network'),
    )
  })

  // Chrome, Firefox, WebKit and React Native wording for an unreachable host. PostgREST answers
  // with a plain error object, not the TypeError itself.
  it.each([
    'Failed to fetch',
    'NetworkError when attempting to fetch resource.',
    'Load failed',
    'Network request failed',
  ])('says offline when an RPC fails with "%s"', async (wording) => {
    const { error } = await unreachable(wording).rpc('settle_up', {
      p_group_id: 'g',
      p_to_user: 'u',
      p_amount_cents: 1,
    })
    expect(error).not.toBeInstanceOf(Error)
    expect(errorMessage(error, 'expenses.errors')).toBe(t('errors.network'))
  })

  it('says offline when signing in never got an answer', async () => {
    const { error } = await unreachable('Failed to fetch').auth.signInWithPassword({
      email: 'ava@example.com',
      password: 'hunter22',
    })
    expect(error?.name).toBe('AuthRetryableFetchError')
    expect(errorMessage(error)).toBe(t('errors.network'))
  })

  it('does not call a bug offline', () => {
    expect(errorMessage(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(
      t('errors.generic'),
    )
    expect(
      errorMessage({ message: 'TypeError: Cannot read properties of undefined', code: '' }),
    ).toBe(t('errors.generic'))
  })
})
