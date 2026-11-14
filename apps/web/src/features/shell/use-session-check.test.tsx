import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authCallsTo, resetDb, respondAuth } from '@/test/supabase'
import { SESSION_CHECK_INTERVAL_MS, useSessionCheck } from './use-session-check'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

function Probe() {
  useSessionCheck()
  return null
}

const signedIn = { data: { session: { user: { id: 'u-1' }, access_token: 'token' } } }
const authError = (name: string, status: number) => ({
  data: { user: null },
  error: Object.assign(new Error(name), { name, status }),
})

describe('useSessionCheck', () => {
  beforeEach(() => {
    resetDb()
    respondAuth('getSession', signedIn)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['ended elsewhere', 'AuthSessionMissingError', 400],
    ['for a deleted account', 'AuthApiError', 403],
    ['with a token the server refuses', 'AuthApiError', 401],
  ])('signs this device out when the session was %s', async (_case, name, status) => {
    respondAuth('getUser', authError(name, status))
    render(<Probe />)
    await waitFor(() => expect(authCallsTo('signOut')).toEqual([[{ scope: 'local' }]]))
  })

  it('stays signed in while the session is alive, or the network is down', async () => {
    respondAuth('getUser', { data: { user: { id: 'u-1' } }, error: null })
    const { unmount } = render(<Probe />)
    await waitFor(() => expect(authCallsTo('getUser')).toHaveLength(1))
    unmount()

    respondAuth('getUser', authError('AuthRetryableFetchError', 0))
    render(<Probe />)
    await waitFor(() => expect(authCallsTo('getUser')).toHaveLength(2))
    await act(async () => {})
    expect(authCallsTo('signOut')).toEqual([])
  })

  it('checks again when the app comes back to the front, at most every 30 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    respondAuth('getUser', { data: { user: { id: 'u-1' } }, error: null })
    render(<Probe />)
    await waitFor(() => expect(authCallsTo('getUser')).toHaveLength(1))

    act(() => window.dispatchEvent(new Event('focus')))
    await act(async () => {})
    expect(authCallsTo('getUser')).toHaveLength(1)

    vi.advanceTimersByTime(SESSION_CHECK_INTERVAL_MS + 1)
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(() => expect(authCallsTo('getUser')).toHaveLength(2))
  })

  it('does not ask the server without a session', async () => {
    respondAuth('getSession', { data: { session: null } })
    render(<Probe />)
    await waitFor(() => expect(authCallsTo('getSession').length).toBeGreaterThan(0))
    await act(async () => {})
    expect(authCallsTo('getUser')).toEqual([])
  })
})
