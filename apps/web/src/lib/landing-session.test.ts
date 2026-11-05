import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

/** A fresh session store and fake client, as on a first page load. */
async function freshLoad(url: string) {
  window.history.replaceState(null, '', url)
  vi.resetModules()
  const auth = await import('./auth')
  const fake = await import('@/test/supabase')
  fake.respondAuth('getSession', { data: { session: { user: { id: 'u-ava' } } } })
  return { auth, fake }
}

describe('reading the session on first load', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  it('answers signed out on the landing page without loading the client', async () => {
    const { auth, fake } = await freshLoad('/')
    expect(await auth.getSession()).toBeNull()
    expect(fake.authCallsTo('getSession')).toHaveLength(0)
  })

  it('reads the stored session on the landing page when this browser has one', async () => {
    localStorage.setItem('sb-test-auth-token', '{}')
    const { auth, fake } = await freshLoad('/')
    expect(await auth.getSession()).toEqual({ user: { id: 'u-ava' } })
    expect(fake.authCallsTo('getSession')).toHaveLength(1)
  })

  it('reads it when a sign in result arrives in the URL', async () => {
    const { auth } = await freshLoad('/?code=abc123')
    expect(await auth.getSession()).toEqual({ user: { id: 'u-ava' } })
  })

  it('always reads it away from the landing page', async () => {
    const { auth } = await freshLoad('/groups')
    expect(await auth.getSession()).toEqual({ user: { id: 'u-ava' } })
  })
})
