import { act, renderHook, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { emitAuth, respondAuth } from '@/test/supabase'
import { authCallbackUrl, getSession, useSession, useUserId } from './auth'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

const ava = { user: { id: 'u-ava' } }
const ben = { user: { id: 'u-ben' } }

// The session store lives for the whole module, so these run in order on purpose.
describe('session hooks', () => {
  // Off the landing page the stored session is always read, so the client loads.
  beforeAll(() => window.history.replaceState(null, '', '/home'))
  afterAll(() => window.history.replaceState(null, '', '/'))

  it('refuses to name a user before anyone signed in', async () => {
    respondAuth('getSession', { data: { session: null } })
    expect(await getSession()).toBeNull()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useUserId())).toThrow('useUserId called without a session')
  })

  it('follows sign in, account switches and sign out', async () => {
    const { result } = renderHook(() => ({ session: useSession() }))
    expect(result.current.session).toBeNull()

    act(() => emitAuth('SIGNED_IN', ava))
    await waitFor(() => expect(result.current.session).toBe(ava))
    const ids = renderHook(() => useUserId())
    expect(ids.result.current).toBe('u-ava')

    act(() => emitAuth('SIGNED_IN', ben))
    expect(ids.result.current).toBe('u-ben')

    // Right after sign out the last id sticks for the render before the redirect.
    act(() => emitAuth('SIGNED_OUT', null))
    expect(result.current.session).toBeNull()
    expect(ids.result.current).toBe('u-ben')
    expect(await getSession()).toBeNull()
  })
})

describe('authCallbackUrl', () => {
  it('points at the callback on this origin and carries where to go next', () => {
    expect(authCallbackUrl()).toBe(`${window.location.origin}/auth/callback`)
    expect(authCallbackUrl('/join/abc')).toBe(
      `${window.location.origin}/auth/callback?redirect=%2Fjoin%2Fabc`,
    )
  })
})
