import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSessionEnded, sessionEndedHere } from '@/lib/auth'
import { authCallsTo, emitAuth, resetDb, respondAuth } from '@/test/supabase'
import { SESSION_CHECK_INTERVAL_MS, useSessionCheck } from './use-session-check'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

function Probe() {
  useSessionCheck()
  return null
}

const signedIn = { data: { session: { user: { id: 'u-1' }, access_token: 'token' } } }
const authError = (name: string, status: number, code?: string) => ({
  data: { user: null },
  error: Object.assign(new Error(name), { name, status, code }),
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
    ['ended elsewhere', 'AuthSessionMissingError', 400, undefined],
    ['for a deleted account', 'AuthApiError', 403, 'user_not_found'],
  ])('signs this device out when the session was %s', async (_case, name, status, code) => {
    respondAuth('getUser', authError(name, status, code))
    render(<Probe />)
    await waitFor(() => expect(authCallsTo('signOut')).toEqual([[{ scope: 'local' }]]))
  })

  it('stays signed in while the session is alive, the network is down or the token expired', async () => {
    respondAuth('getUser', { data: { user: { id: 'u-1' } }, error: null })
    const first = render(<Probe />)
    await waitFor(() => expect(authCallsTo('getUser')).toHaveLength(1))
    first.unmount()

    respondAuth('getUser', authError('AuthRetryableFetchError', 0))
    const second = render(<Probe />)
    await waitFor(() => expect(authCallsTo('getUser')).toHaveLength(2))
    second.unmount()

    respondAuth('getUser', authError('AuthApiError', 401, 'bad_jwt'))
    render(<Probe />)
    await waitFor(() => expect(authCallsTo('getUser')).toHaveLength(3))
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

  it('checks every 30 seconds while the app stays on screen, never while it is hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    respondAuth('getUser', { data: { user: { id: 'u-1' } }, error: null })
    render(<Probe />)
    await waitFor(() => expect(authCallsTo('getUser')).toHaveLength(1))

    // No focus or visibility event: the open tab still notices.
    await act(async () => vi.advanceTimersByTime(SESSION_CHECK_INTERVAL_MS + 1))
    await waitFor(() => expect(authCallsTo('getUser')).toHaveLength(2))

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => vi.advanceTimersByTime(SESSION_CHECK_INTERVAL_MS + 1))
    await act(async () => {})
    expect(authCallsTo('getUser')).toHaveLength(2)
    visibility.mockRestore()
  })

  it('checks within 30 seconds of the last check, even when focus brought one in between', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    respondAuth('getUser', { data: { user: { id: 'u-1' } }, error: null })
    render(<Probe />)
    await waitFor(() => expect(authCallsTo('getUser')).toHaveLength(1))

    // Hidden past one 30 second mark, then back 45 seconds in: that brings a check.
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => vi.advanceTimersByTime(45_000))
    visibility.mockRestore()
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(authCallsTo('getUser')).toHaveLength(2))

    // The next one comes 30 seconds after that, not at the following 30 second mark from the start.
    await act(async () => vi.advanceTimersByTime(SESSION_CHECK_INTERVAL_MS + 1))
    await waitFor(() => expect(authCallsTo('getUser')).toHaveLength(3))
  })

  it('leaves a note for the sign-in page when the session ended elsewhere', async () => {
    respondAuth('getUser', authError('AuthSessionMissingError', 400))
    clearSessionEnded()
    render(<Probe />)
    await waitFor(() => expect(authCallsTo('signOut')).toEqual([[{ scope: 'local' }]]))
    expect(sessionEndedHere()).toBe(true)
    clearSessionEnded()
    expect(sessionEndedHere()).toBe(false)
  })

  it('leaves the note even when auth-js drops the session inside the check', async () => {
    clearSessionEnded()
    // What supabase-js does for `session_not_found`: forget the session and announce the
    // sign out before `getUser` returns.
    respondAuth('getUser', async () => {
      respondAuth('getSession', { data: { session: null } })
      expect(sessionEndedHere()).toBe(false)
      emitAuth('SIGNED_OUT')
      return authError('AuthSessionMissingError', 400)
    })
    render(<Probe />)
    await waitFor(() => expect(sessionEndedHere()).toBe(true))
    // Nothing left to sign out: the session was already gone.
    expect(authCallsTo('signOut')).toEqual([])
    clearSessionEnded()
  })

  it.each([['session_not_found'], ['user_not_found'], ['session_ended']])(
    'leaves the note when the check answers %s',
    async (code) => {
      clearSessionEnded()
      respondAuth('getUser', authError('AuthApiError', 403, code))
      render(<Probe />)
      await waitFor(() => expect(authCallsTo('signOut')).toEqual([[{ scope: 'local' }]]))
      expect(sessionEndedHere()).toBe(true)
      clearSessionEnded()
    },
  )

  it('does not ask the server without a session', async () => {
    respondAuth('getSession', { data: { session: null } })
    render(<Probe />)
    await waitFor(() => expect(authCallsTo('getSession').length).toBeGreaterThan(0))
    await act(async () => {})
    expect(authCallsTo('getUser')).toEqual([])
  })
})
