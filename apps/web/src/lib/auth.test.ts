import type * as ApiModule from '@potluck/api'
import type { Session } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assuranceLevel,
  getSession,
  needsOnboarding,
  needsSecondFactor,
  safeRedirect,
  signOut,
} from './auth'

const fake = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  authSignOut: vi.fn(async () => ({ error: null })),
  deletePushToken: vi.fn(async () => undefined),
  unsubscribe: vi.fn(async () => true),
  subscription: null as null | { endpoint: string; unsubscribe: () => Promise<boolean> },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: fake.session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      signOut: fake.authSignOut,
    },
  },
}))

vi.mock('@potluck/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  deletePushToken: fake.deletePushToken,
}))

describe('safeRedirect', () => {
  it('keeps same-origin paths, including search', () => {
    expect(safeRedirect('/join/hikecrew-demo')).toBe('/join/hikecrew-demo')
    expect(safeRedirect('/groups?new=true')).toBe('/groups?new=true')
  })

  it('refuses anything that could leave the site', () => {
    expect(safeRedirect('https://evil.example')).toBe('/home')
    expect(safeRedirect('//evil.example')).toBe('/home')
    expect(safeRedirect('/\\evil.example')).toBe('/home')
    expect(safeRedirect(undefined, '/welcome')).toBe('/welcome')
  })
})

describe('needsOnboarding', () => {
  const session = (user_metadata: Record<string, unknown>) =>
    ({ user: { id: 'u-1', user_metadata } }) as unknown as Session

  it('sends every new account through onboarding, whatever the sign in method', () => {
    expect(needsOnboarding(session({}))).toBe(true)
    expect(needsOnboarding(session({ full_name: 'Ava Chen', avatar_url: 'https://x/a.png' }))).toBe(
      true,
    )
    expect(needsOnboarding(session({ display_name: 'Ava', timezone: 'UTC' }))).toBe(true)
  })

  it('stops once the profile has been saved', () => {
    expect(needsOnboarding(session({ onboarded: true }))).toBe(false)
    expect(needsOnboarding(session({ onboarded: 'true' }))).toBe(true)
  })

  it('is false without a session', () => {
    expect(needsOnboarding(null)).toBe(false)
  })
})

describe('signOut', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // supabase-js keeps the session under sb-<ref>-auth-token; with none stored the landing
    // page answers "signed out" without loading the client.
    localStorage.setItem('sb-test-auth-token', '{}')
    fake.session = { user: { id: 'u-ava' } }
    fake.subscription = {
      endpoint: 'https://push.example/ava-device',
      unsubscribe: fake.unsubscribe,
    }
    vi.stubGlobal('PushManager', class {})
    vi.stubGlobal('Notification', { permission: 'granted' })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: async () => ({
          pushManager: { getSubscription: async () => fake.subscription },
        }),
      },
    })
    await getSession()
  })

  it("drops this browser's push registration for the account before ending the session", async () => {
    await signOut()
    expect(fake.deletePushToken).toHaveBeenCalledWith(
      expect.anything(),
      'u-ava',
      'https://push.example/ava-device',
    )
    expect(fake.unsubscribe).toHaveBeenCalled()
    expect(fake.authSignOut).toHaveBeenCalled()
    expect(fake.deletePushToken.mock.invocationCallOrder[0]).toBeLessThan(
      fake.authSignOut.mock.invocationCallOrder[0]!,
    )
  })

  it('still kills the browser subscription and ends the session when the row delete fails', async () => {
    fake.deletePushToken.mockRejectedValueOnce(new Error('offline'))
    await expect(signOut()).resolves.toBeUndefined()
    expect(fake.unsubscribe).toHaveBeenCalled()
    expect(fake.authSignOut).toHaveBeenCalled()
  })

  it('has nothing to clean up on a device without a subscription', async () => {
    fake.subscription = null
    await signOut()
    expect(fake.deletePushToken).not.toHaveBeenCalled()
    expect(fake.authSignOut).toHaveBeenCalled()
  })

  it('revokes every session of the account when asked to', async () => {
    fake.subscription = null
    await signOut('global')
    expect(fake.authSignOut).toHaveBeenCalledWith({ scope: 'global' })
  })

  it('reports a failed global sign out instead of pretending it worked', async () => {
    fake.subscription = null
    const failure = { code: 'unexpected_failure', message: 'down' }
    fake.authSignOut.mockResolvedValueOnce({ error: failure } as never)
    await expect(signOut('global')).rejects.toBe(failure)
  })
})

describe('needsSecondFactor', () => {
  const token = (claims: object) =>
    `h.${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.s`
  const session = (claims: object, factors: { status: string }[] = []) =>
    ({ access_token: token(claims), user: { id: 'u-1', factors } }) as unknown as Session

  it('asks for the code while a verified factor meets an aal1 token', () => {
    const verified = [{ status: 'verified' }]
    expect(needsSecondFactor(session({ aal: 'aal1' }, verified))).toBe(true)
    expect(needsSecondFactor(session({}, verified))).toBe(true)
    expect(assuranceLevel(session({ aal: 'aal2' }))).toBe('aal2')
  })

  it('lets everyone else through', () => {
    expect(needsSecondFactor(null)).toBe(false)
    expect(needsSecondFactor(session({ aal: 'aal2' }, [{ status: 'verified' }]))).toBe(false)
    expect(needsSecondFactor(session({ aal: 'aal1' }, [{ status: 'unverified' }]))).toBe(false)
    expect(needsSecondFactor(session({ aal: 'aal1' }))).toBe(false)
  })

  it('treats an unreadable token as aal1', () => {
    expect(assuranceLevel({ access_token: 'nope' } as Session)).toBe('aal1')
    expect(assuranceLevel(session({ aal: 2 }))).toBe('aal1')
  })
})
