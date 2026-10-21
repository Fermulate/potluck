import type * as ApiModule from '@potluck/api'
import type { Session } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSession, needsOnboarding, safeRedirect, signOut } from './auth'

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
})
