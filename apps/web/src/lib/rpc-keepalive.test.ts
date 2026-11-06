import { afterEach, describe, expect, it, vi } from 'vitest'

let token: string | null = 'session-token'
vi.mock('@/lib/auth', () => ({ accessToken: () => token }))
vi.mock('@/lib/supabase', () => import('@/test/supabase'))

const { rpcKeepalive } = await import('./rpc-keepalive')

describe('rpcKeepalive', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    token = 'session-token'
  })

  it('posts the function arguments to PostgREST on a keepalive request as the session', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('2', { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    const response = await rpcKeepalive('set_availability', { event_id: 'e1', slots: [] })

    expect(await response.text()).toBe('2')
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

  it('falls back to the publishable key as bearer without a session, like the client', async () => {
    token = null
    const fetchMock = vi.fn(() => Promise.resolve(new Response('null')))
    vi.stubGlobal('fetch', fetchMock)

    await rpcKeepalive('set_availability', { event_id: 'e1', slots: [] })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key')
  })
})
