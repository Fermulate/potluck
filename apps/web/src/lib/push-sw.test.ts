import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The worker script is plain JavaScript served from public/; run it against a fake worker scope.
const source = readFileSync(resolve(import.meta.dirname, '../../public/push-sw.js'), 'utf8')
const ORIGIN = 'https://potluck.test'

interface FakeClient {
  url: string
  focus: ReturnType<typeof vi.fn>
  navigate: ReturnType<typeof vi.fn>
}

function client(url: string, navigate = vi.fn(async (href: string) => ({ url: href }))) {
  const c: FakeClient = { url, navigate, focus: vi.fn() }
  c.focus.mockResolvedValue(c)
  return c
}

function worker({ controlled = [] as FakeClient[], uncontrolled = [] as FakeClient[] } = {}) {
  const handlers = new Map<string, (event: unknown) => void>()
  const clients = {
    matchAll: vi.fn(async (options?: { includeUncontrolled?: boolean }) =>
      options?.includeUncontrolled ? [...controlled, ...uncontrolled] : controlled,
    ),
    openWindow: vi.fn(async (href: string) => ({ url: href })),
  }
  const scope = {
    location: { origin: ORIGIN },
    clients,
    registration: { showNotification: vi.fn() },
    addEventListener: (type: string, handler: (event: unknown) => void) =>
      handlers.set(type, handler),
  }
  new Function('self', source)(scope)

  async function click(url?: string) {
    let done: Promise<unknown> = Promise.resolve()
    handlers.get('notificationclick')!({
      notification: { close: vi.fn(), data: { url } },
      waitUntil: (promise: Promise<unknown>) => {
        done = promise
      },
    })
    await done
  }
  return { clients, click }
}

describe('push worker notification click', () => {
  beforeEach(() => vi.clearAllMocks())

  it('focuses and navigates an open tab it controls', async () => {
    const tab = client(`${ORIGIN}/groups`)
    const { clients, click } = worker({ controlled: [tab] })
    await click('/plans/e1')
    expect(tab.focus).toHaveBeenCalled()
    expect(tab.navigate).toHaveBeenCalledWith(`${ORIGIN}/plans/e1`)
    expect(clients.openWindow).not.toHaveBeenCalled()
  })

  it('opens a window instead of navigating a tab it does not control', async () => {
    const tab = client(`${ORIGIN}/groups`)
    const { clients, click } = worker({ uncontrolled: [tab] })
    await click('/plans/e1')
    expect(tab.navigate).not.toHaveBeenCalled()
    expect(clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/plans/e1`)
  })

  it('opens a window when navigating the tab fails', async () => {
    const tab = client(
      `${ORIGIN}/groups`,
      vi.fn(async () => {
        throw new TypeError('not controlled')
      }),
    )
    const { clients, click } = worker({ controlled: [tab] })
    await click('/notifications')
    expect(clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/notifications`)
  })

  it('never leaves the app origin', async () => {
    const { clients, click } = worker()
    await click('https://evil.example/phish')
    expect(clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/notifications`)
  })
})
