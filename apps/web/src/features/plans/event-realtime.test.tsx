import { guestKeys, plansKeys } from '@potluck/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emitChange, emitJoined, resetDb } from '@/test/supabase'
import { useEventRealtime } from './use-event'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

describe('useEventRealtime', () => {
  beforeEach(() => {
    resetDb()
    client = new QueryClient()
  })

  it('refetches what each change touches', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderHook(() => useEventRealtime('e1', 'g1'), { wrapper })

    emitChange('availability', 'INSERT', {})
    emitChange('event_rsvps', 'UPDATE', {})
    emitChange('activity', 'INSERT', { verb: 'comment.created', data: { event_id: 'e1' } })
    emitChange('activity', 'INSERT', { verb: 'comment.created', data: { event_id: 'other' } })
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: plansKeys.comments('e1') }),
    )
    for (const key of [
      plansKeys.availability('e1'),
      plansKeys.bestSlots('e1'),
      plansKeys.requests('e1'),
      plansKeys.rsvps('e1'),
    ]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key })
    }
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: plansKeys.event('e1') })

    emitChange('events', 'UPDATE', {})
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: plansKeys.groupEvents('g1') }),
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: plansKeys.event('e1') })
  })

  it('refetches guests, their slots and link usage when a guest answers', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderHook(() => useEventRealtime('e1', 'g1'), { wrapper })

    emitChange('event_guest_availability', 'INSERT', {})
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: guestKeys.slots('e1') }),
    )
    for (const key of [guestKeys.guests('e1'), guestKeys.links('e1'), plansKeys.bestSlots('e1')]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key })
    }
  })

  it('refetches the whole plan once the live channel joins, for answers sent before', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderHook(() => useEventRealtime('e1', 'g1'), { wrapper })
    expect(invalidate).not.toHaveBeenCalled()

    emitJoined('availability')
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: plansKeys.availability('e1') }),
    )
    for (const key of [
      plansKeys.bestSlots('e1'),
      plansKeys.requests('e1'),
      guestKeys.slots('e1'),
      guestKeys.guests('e1'),
      guestKeys.links('e1'),
      plansKeys.event('e1'),
      plansKeys.rsvps('e1'),
      plansKeys.comments('e1'),
    ]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key })
    }
  })

  it('waits for the group before listening', () => {
    renderHook(() => useEventRealtime('e1', undefined), { wrapper })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    emitChange('availability', 'INSERT', {})
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('keeps listening when another view of the same plan closes', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const first = renderHook(() => useEventRealtime('e1', 'g1'), { wrapper })
    renderHook(() => useEventRealtime('e1', 'g1'), { wrapper })
    first.unmount()

    emitChange('event_rsvps', 'INSERT', {})
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: plansKeys.rsvps('e1') }),
    )
  })
})
