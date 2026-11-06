import { afterEach, describe, expect, it, vi } from 'vitest'

let token: string | null = 'session-token'
vi.mock('@/lib/auth', () => ({ accessToken: () => token }))
vi.mock('@/lib/supabase', () => import('@/test/supabase'))

const { rpcKeepalive, KEEPALIVE_BODY_LIMIT } = await import('./rpc-keepalive')

function stubFetch() {
  const fetchMock = vi.fn(() => Promise.resolve(new Response('2', { status: 200 })))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('rpcKeepalive', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    token = 'session-token'
  })

  it('posts the function arguments to PostgREST on a keepalive request as the session', () => {
    const fetchMock = stubFetch()

    expect(rpcKeepalive('set_availability', { event_id: 'e1', slots: [] })).toBe(true)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://db.test/rest/v1/rpc/set_availability')
    expect(init.method).toBe('POST')
    expect(init.keepalive).toBe(true)
    expect(init.headers).toEqual({
      apikey: 'test-key',
      authorization: 'Bearer session-token',
      'content-type': 'application/json',
    })
    expect(JSON.parse(init.body as string)).toEqual({ event_id: 'e1', slots: [] })
  })

  it('sends nothing without a session', () => {
    token = null
    const fetchMock = stubFetch()

    expect(rpcKeepalive('set_availability', { event_id: 'e1', slots: [] })).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends nothing when the body is over the keepalive quota', () => {
    const fetchMock = stubFetch()
    const slots = Array.from({ length: 1_200 }, (_, i) => ({
      slot_start: new Date(Date.UTC(2026, 5, 1, 0, 30 * i)).toISOString(),
      level: 'yes',
    }))
    expect(JSON.stringify({ event_id: 'e1', slots }).length).toBeGreaterThan(KEEPALIVE_BODY_LIMIT)

    expect(rpcKeepalive('set_availability', { event_id: 'e1', slots })).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('swallows a refused request, since the page is leaving', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    vi.stubGlobal('fetch', fetchMock)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)

    expect(rpcKeepalive('set_availability', { event_id: 'e1', slots: [] })).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))

    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })
})
