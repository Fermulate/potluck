import { PlanError } from '@potluck/api'
import { t } from '@potluck/i18n'
import { describe, expect, it } from 'vitest'
import { errorMessage } from './errors'

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
})
