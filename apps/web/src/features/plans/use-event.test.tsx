import type * as Api from '@potluck/api'
import { PlanError, plansKeys, type PlanAvailabilityRow } from '@potluck/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaintLevel } from '@/features/availability/grid'

type Deferred = { resolve: () => void; reject: (error: unknown) => void }
const calls: { slots: { slot_start: string; level: PaintLevel }[]; deferred: Deferred }[] = []
const setAvailability = vi.fn(
  (_client: unknown, _eventId: string, slots: { slot_start: string; level: PaintLevel }[]) =>
    new Promise<number>((resolve, reject) => {
      calls.push({ slots, deferred: { resolve: () => resolve(slots.length), reject } })
    }),
)
vi.mock('@potluck/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  setAvailability: (...args: unknown[]) =>
    setAvailability(...(args as Parameters<typeof setAvailability>)),
}))
vi.mock('@potluck/ui', () => ({ toast: { error: vi.fn() } }))

const { useMyAvailability } = await import('./use-event')

const EVENT = 'e1'
const slotA = '2026-06-12T18:00:00.000Z'
const slotB = '2026-06-12T18:30:00.000Z'
const map = (...entries: [string, PaintLevel][]) => new Map<string, PaintLevel>(entries)

let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)
const cached = () =>
  (client.getQueryData<PlanAvailabilityRow[]>(plansKeys.availability(EVENT)) ?? [])
    .filter((r) => r.user_id === 'me')
    .map((r) => r.slot_start)
    .sort()

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useMyAvailability', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    calls.length = 0
    setAvailability.mockClear()
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData<PlanAvailabilityRow[]>(plansKeys.availability(EVENT), [
      { event_id: EVENT, user_id: 'ben', slot_start: slotA, level: 'yes' },
    ])
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends one save at a time and ends on the latest map', async () => {
    const { result } = renderHook(() => useMyAvailability(EVENT, 'me', map()), { wrapper })

    act(() => result.current.change(map([slotA, 'yes'])))
    act(() => vi.advanceTimersByTime(700))
    await flush()
    expect(calls).toHaveLength(1)
    expect(result.current.state).toBe('saving')

    // Paint again while the first save is still on the wire.
    act(() => result.current.change(map([slotA, 'yes'], [slotB, 'maybe'])))
    act(() => vi.advanceTimersByTime(700))
    await flush()
    expect(calls).toHaveLength(1)

    calls[0]!.deferred.resolve()
    await flush()
    expect(result.current.state).toBe('saving')
    expect(calls).toHaveLength(2)
    expect(calls[1]!.slots.map((s) => s.slot_start)).toEqual([slotA, slotB])

    calls[1]!.deferred.resolve()
    await flush()
    expect(result.current.state).toBe('saved')
    expect(cached()).toEqual([slotA, slotB])
    expect(
      client
        .getQueryData<PlanAvailabilityRow[]>(plansKeys.availability(EVENT))!
        .some((r) => r.user_id === 'ben'),
    ).toBe(true)
  })

  it('restores the saved map to the cache after another refetch dropped it', async () => {
    const { result } = renderHook(() => useMyAvailability(EVENT, 'me', map()), { wrapper })
    act(() => result.current.change(map([slotA, 'yes'])))
    act(() => vi.advanceTimersByTime(700))
    await flush()

    // A Realtime refetch for someone else lands with the server not yet holding my rows.
    client.setQueryData<PlanAvailabilityRow[]>(plansKeys.availability(EVENT), [
      { event_id: EVENT, user_id: 'ben', slot_start: slotB, level: 'maybe' },
    ])
    expect(cached()).toEqual([])

    calls[0]!.deferred.resolve()
    await flush()
    expect(cached()).toEqual([slotA])
  })

  it('retries a failed save with backoff and keeps the map until it lands', async () => {
    const { result } = renderHook(() => useMyAvailability(EVENT, 'me', map()), { wrapper })
    act(() => result.current.change(map([slotA, 'yes'])))
    act(() => vi.advanceTimersByTime(700))
    await flush()

    calls[0]!.deferred.reject(new Error('offline'))
    await flush()
    expect(result.current.state).toBe('error')
    expect(calls).toHaveLength(1)

    act(() => vi.advanceTimersByTime(1_000))
    await flush()
    expect(calls).toHaveLength(2)
    expect(calls[1]!.slots.map((s) => s.slot_start)).toEqual([slotA])

    calls[1]!.deferred.reject(new Error('offline'))
    await flush()
    act(() => vi.advanceTimersByTime(1_000))
    await flush()
    expect(calls).toHaveLength(2)
    act(() => vi.advanceTimersByTime(1_000))
    await flush()
    expect(calls).toHaveLength(3)

    calls[2]!.deferred.resolve()
    await flush()
    expect(result.current.state).toBe('saved')
    expect(cached()).toEqual([slotA])
  })

  it('gives up after a few attempts and says so', async () => {
    const { result } = renderHook(() => useMyAvailability(EVENT, 'me', map()), { wrapper })
    act(() => result.current.change(map([slotA, 'yes'])))
    act(() => vi.advanceTimersByTime(700))
    await flush()
    for (let i = 0; i < 4; i++) {
      calls[i]!.deferred.reject(new Error('offline'))
      await flush()
      expect(result.current.state).toBe(i < 3 ? 'error' : 'failed')
      act(() => vi.advanceTimersByTime(10_000))
      await flush()
    }
    expect(calls).toHaveLength(4)
    expect(result.current.state).toBe('failed')

    await act(async () => {
      void result.current.retry()
    })
    await flush()
    expect(calls).toHaveLength(5)
    expect(calls[4]!.slots.map((s) => s.slot_start)).toEqual([slotA])
    calls[4]!.deferred.resolve()
    await flush()
    expect(result.current.state).toBe('saved')
  })

  it('drops the map and refetches when the server rejects the save outright', async () => {
    client.setQueryData(plansKeys.event(EVENT), { id: EVENT, status: 'polling' })
    const { result } = renderHook(() => useMyAvailability(EVENT, 'me', map()), { wrapper })
    act(() => result.current.change(map([slotA, 'yes'])))
    act(() => vi.advanceTimersByTime(700))
    await flush()
    expect(cached()).toEqual([slotA])

    calls[0]!.deferred.reject(new PlanError('event_not_polling'))
    await flush()
    expect(result.current.state).toBe('rejected')
    expect(result.current.rejection).toBe('This plan is no longer collecting times.')
    expect([...result.current.value.keys()]).toEqual([])
    expect(client.getQueryState(plansKeys.event(EVENT))?.isInvalidated).toBe(true)
    expect(client.getQueryState(plansKeys.availability(EVENT))?.isInvalidated).toBe(true)

    act(() => vi.advanceTimersByTime(60_000))
    await flush()
    expect(calls).toHaveLength(1)
  })

  it('still retries a plan error the server did not raise on purpose', async () => {
    const { result } = renderHook(() => useMyAvailability(EVENT, 'me', map()), { wrapper })
    act(() => result.current.change(map([slotA, 'yes'])))
    act(() => vi.advanceTimersByTime(700))
    await flush()
    calls[0]!.deferred.reject(new PlanError('TypeError: Failed to fetch'))
    await flush()
    expect(result.current.state).toBe('error')
    act(() => vi.advanceTimersByTime(1_000))
    await flush()
    expect(calls).toHaveLength(2)
  })

  it('mirrors the server rows until the first paint, then keeps the edits', async () => {
    const { result, rerender } = renderHook(
      ({ initial }: { initial: Map<string, PaintLevel> }) =>
        useMyAvailability(EVENT, 'me', initial),
      { wrapper, initialProps: { initial: map() } },
    )
    expect([...result.current.value.keys()]).toEqual([])

    rerender({ initial: map([slotA, 'yes']) })
    expect([...result.current.value.keys()]).toEqual([slotA])

    act(() => result.current.change(map([slotB, 'maybe'])))
    rerender({ initial: map([slotA, 'yes']) })
    expect([...result.current.value.keys()]).toEqual([slotB])
  })
})
