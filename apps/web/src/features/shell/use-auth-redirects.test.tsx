import { act, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSupabase } from '@/lib/auth'
import { renderWithProviders } from '@/test/render'
import { emitAuth, resetDb } from '@/test/supabase'
import { useAuthRedirects } from './use-auth-redirects'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

function Probe() {
  useAuthRedirects()
  return <p>signed in screen</p>
}

async function renderAt(path: string) {
  const view = renderWithProviders(<Probe />, { path })
  await screen.findByText('signed in screen')
  return view
}

describe('useAuthRedirects', () => {
  // Auth events flow once the client has loaded, which any signed in screen does.
  beforeAll(async () => {
    await loadSupabase()
  })

  beforeEach(() => {
    resetDb()
  })

  it('drops cached data and leaves private screens on sign out', async () => {
    const { router, queryClient } = await renderAt('/groups')
    queryClient.setQueryData(['potluck', 'groups'], ['secret'])
    act(() => emitAuth('SIGNED_OUT'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    expect(queryClient.getQueryData(['potluck', 'groups'])).toBeUndefined()
  })

  it.each(['/', '/sign-up', '/join/hikecrew-demo', '/auth/callback', '/forgot-password'])(
    'stays on the public page %s after sign out',
    async (path) => {
      const { router } = await renderAt(path)
      act(() => emitAuth('SIGNED_OUT'))
      await act(async () => {})
      expect(router.state.location.pathname).toBe(path)
    },
  )

  it('opens the reset form from a recovery link', async () => {
    const { router } = await renderAt('/home')
    act(() => emitAuth('PASSWORD_RECOVERY'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/reset-password'))
  })

  it('ignores other auth events and stops listening on unmount', async () => {
    const { router, unmount } = await renderAt('/home')
    act(() => emitAuth('TOKEN_REFRESHED'))
    await act(async () => {})
    expect(router.state.location.pathname).toBe('/home')
    unmount()
    emitAuth('SIGNED_OUT')
    await act(async () => {})
    expect(router.state.location.pathname).toBe('/home')
  })
})
