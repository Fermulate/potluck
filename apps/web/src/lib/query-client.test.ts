import { PlanError } from '@potluck/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authCallsTo, resetDb, respondAuth } from '@/test/supabase'
import { isNotFoundError } from './errors'
import { queryClient, shouldRetry } from './query-client'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

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

  it('never retries a session that was signed out elsewhere', () => {
    expect(shouldRetry(0, { code: '42501', message: 'session_ended' })).toBe(false)
  })
})

describe('a session signed out on another device', () => {
  beforeEach(() => {
    resetDb()
    respondAuth('getSession', { data: { session: { user: { id: 'u-1' } } } })
  })

  it('signs this device out when a read finds it ended', async () => {
    await expect(
      queryClient.fetchQuery({
        queryKey: ['session-ended-read'],
        queryFn: () => Promise.reject({ code: '42501', message: 'session_ended' }),
      }),
    ).rejects.toMatchObject({ message: 'session_ended' })
    await vi.waitFor(() => expect(authCallsTo('signOut')).toEqual([[{ scope: 'local' }]]))
  })

  it('and when a write does', async () => {
    const write = queryClient.getMutationCache().build(queryClient, {
      mutationFn: () => Promise.reject(new PlanError('session_ended')),
    })
    await expect(write.execute(undefined)).rejects.toBeInstanceOf(PlanError)
    await vi.waitFor(() => expect(authCallsTo('signOut')).toEqual([[{ scope: 'local' }]]))
  })

  it('leaves other failures alone', async () => {
    await expect(
      queryClient.fetchQuery({
        queryKey: ['other-failure'],
        queryFn: () => Promise.reject({ code: '42501', message: 'not_a_member' }),
        retry: false,
      }),
    ).rejects.toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(authCallsTo('signOut')).toEqual([])
  })
})
