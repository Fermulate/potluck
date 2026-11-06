import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, payloadOf, resetDb, rowsOf } from '@/test/supabase'
import { useWebPush } from './use-web-push'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'u-ava' }))

const ENDPOINT = 'https://push.example/ava-phone'

function subscription(endpoint = ENDPOINT) {
  return {
    endpoint,
    unsubscribe: vi.fn(async () => true),
    toJSON: () => ({ endpoint, keys: { p256dh: 'k', auth: 'a' } }),
  }
}

const browser = {
  current: null as ReturnType<typeof subscription> | null,
  subscribe: vi.fn(async (_options: { applicationServerKey: Uint8Array }) => subscription()),
  requestPermission: vi.fn(async () => 'granted' as NotificationPermission),
  permission: 'default' as NotificationPermission,
}

function installPush() {
  vi.stubGlobal('PushManager', class {})
  vi.stubGlobal('Notification', {
    get permission() {
      return browser.permission
    },
    requestPermission: browser.requestPermission,
  })
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: async () => ({
        pushManager: {
          getSubscription: async () => browser.current,
          subscribe: browser.subscribe,
        },
      }),
    },
  })
}

function renderPush() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(() => useWebPush(), { wrapper })
}

function seed({ tokens = [] as string[], webPush = true } = {}) {
  resetDb({
    tables: {
      app_config: [{ key: 'web_push', value: webPush }],
      push_tokens: tokens.map((token) => ({ user_id: 'u-ava', token, platform: 'web' })),
    },
  })
}

describe('useWebPush', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    browser.current = null
    browser.permission = 'default'
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'AQID-_8')
    installPush()
    seed()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
  })

  it('is unsupported without service workers', async () => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
    const { result } = renderPush()
    await waitFor(() => expect(result.current.state).toBe('unsupported'))
  })

  it('is not configured without a VAPID key or with the flag off', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '')
    const first = renderPush()
    await waitFor(() => expect(first.result.current.state).toBe('not-configured'))
    expect(await first.result.current.enable()).toBe(false)

    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'AQID-_8')
    seed({ webPush: false })
    const second = renderPush()
    await waitFor(() => expect(second.result.current.state).toBe('not-configured'))
  })

  it('is blocked once the browser denied notifications', async () => {
    browser.permission = 'denied'
    const { result } = renderPush()
    await waitFor(() => expect(result.current.state).toBe('blocked'))
  })

  it('is on only when this account owns the device subscription', async () => {
    browser.current = subscription()
    seed({ tokens: [ENDPOINT] })
    const mine = renderPush()
    await waitFor(() => expect(mine.result.current.state).toBe('on'))

    seed({ tokens: ['https://push.example/someone-else'] })
    const theirs = renderPush()
    await waitFor(() => expect(theirs.result.current.state).toBe('off'))
  })

  it('subscribes with the server key and stores the endpoint', async () => {
    const stale = subscription('https://push.example/stale')
    browser.current = stale
    const { result } = renderPush()
    await waitFor(() => expect(result.current.state).toBe('off'))

    let ok = false
    await act(async () => {
      ok = await result.current.enable()
    })

    expect(ok).toBe(true)
    expect(result.current.state).toBe('on')
    expect(stale.unsubscribe).toHaveBeenCalled()
    const key = browser.subscribe.mock.calls[0]![0].applicationServerKey
    expect(Array.from(key)).toEqual([1, 2, 3, 251, 255])
    const upsert = db()
      .queries('push_tokens')
      .map((call) => payloadOf(call, 'upsert'))
      .find(Boolean)
    expect(upsert).toMatchObject({
      user_id: 'u-ava',
      token: ENDPOINT,
      platform: 'web',
      subscription: { endpoint: ENDPOINT },
    })
  })

  it('drops the replaced subscription from push_tokens', async () => {
    const STALE = 'https://push.example/stale'
    browser.current = subscription(STALE)
    seed({ tokens: [STALE] })
    const { result } = renderPush()
    await waitFor(() => expect(result.current.state).toBe('on'))

    await act(async () => {
      await result.current.enable()
    })

    expect(rowsOf('push_tokens').map((row) => row.token)).toEqual([ENDPOINT])
  })

  it('stays off or blocked when permission is not granted', async () => {
    const { result } = renderPush()
    await waitFor(() => expect(result.current.state).toBe('off'))

    browser.requestPermission.mockResolvedValueOnce('default')
    await act(async () => {
      expect(await result.current.enable()).toBe(false)
    })
    expect(result.current.state).toBe('off')

    browser.requestPermission.mockResolvedValueOnce('denied')
    await act(async () => {
      expect(await result.current.enable()).toBe(false)
    })
    expect(result.current.state).toBe('blocked')
    expect(browser.subscribe).not.toHaveBeenCalled()
  })

  it('turns off by forgetting the token, then the browser subscription', async () => {
    const sub = subscription()
    browser.current = sub
    seed({ tokens: [ENDPOINT] })
    const { result } = renderPush()
    await waitFor(() => expect(result.current.state).toBe('on'))

    await act(async () => {
      await result.current.disable()
    })

    expect(result.current.state).toBe('off')
    expect(sub.unsubscribe).toHaveBeenCalled()
    const remove = db()
      .queries('push_tokens')
      .find((call) => call.ops.some((op) => op.method === 'delete'))
    expect(remove?.ops).toContainEqual({ method: 'eq', args: ['token', ENDPOINT] })
  })
})
