import { PlanError } from '@potluck/api'
import { describe, expect, it } from 'vitest'
import { isNotFoundError } from './errors'
import { queryClient, shouldRetry } from './query-client'

describe('isNotFoundError', () => {
  it('spots 404s from RPCs, PostgREST and the plans API', () => {
    expect(isNotFoundError({ code: 'PT404', message: 'expense_not_found' })).toBe(true)
    expect(isNotFoundError({ code: 'PGRST116', message: 'JSON object requested' })).toBe(true)
    expect(isNotFoundError({ status: 404, message: 'Not Found' })).toBe(true)
    expect(isNotFoundError(new PlanError('event_not_found'))).toBe(true)
    expect(isNotFoundError(Object.assign(new Error('invite_not_found'), { code: 'PT404' }))).toBe(
      true,
    )
  })

  it('leaves other failures alone', () => {
    expect(isNotFoundError(new TypeError('Failed to fetch'))).toBe(false)
    expect(isNotFoundError({ code: '42501', message: 'not_a_member' })).toBe(false)
    expect(isNotFoundError(null)).toBe(false)
  })
})

describe('query retries', () => {
  it('never retries a not found answer', () => {
    expect(shouldRetry(0, { code: 'PT404', message: 'expense_not_found' })).toBe(false)
  })

  it('retries other failures up to three times', () => {
    const error = new TypeError('Failed to fetch')
    expect(shouldRetry(0, error)).toBe(true)
    expect(shouldRetry(2, error)).toBe(true)
    expect(shouldRetry(3, error)).toBe(false)
  })

  it('is the app default', () => {
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(shouldRetry)
  })
})
