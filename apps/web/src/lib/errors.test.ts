import { describe, expect, it } from 'vitest'
import { errorMessage } from './errors'

describe('errorMessage', () => {
  it('translates stable RPC codes carried in message', () => {
    expect(errorMessage({ message: 'member_has_balance', details: 'English text' })).toBe(
      'They still have an open balance here. Settle up first.',
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
})
