import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTimeZone } from '@/features/expenses/money-data'
import { useViewer } from '@/features/plans/viewer'
import { resetDb } from '@/test/supabase'
import { useViewerTimezone } from './queries'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'u-ava' }))

const DEVICE = 'America/New_York'

function profile(timezone: string | null) {
  resetDb({ tables: { profiles: [{ id: 'u-ava', display_name: 'Ava', timezone }] } })
}

/** Every hook a screen uses to pick its zone, read once the profile has loaded. */
function zones() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(
    () => {
      const plans = useViewer()
      return {
        loaded: !!plans.profile,
        money: useTimeZone(),
        shell: useViewerTimezone(),
        plans: plans.timeZone,
      }
    },
    { wrapper },
  )
}

describe('viewer time zone', () => {
  beforeEach(() => {
    const original = Intl.DateTimeFormat.prototype.resolvedOptions
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
      this: Intl.DateTimeFormat,
    ) {
      return { ...original.call(this), timeZone: DEVICE }
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('honors a profile set to UTC on every screen', async () => {
    profile('UTC')
    const { result } = zones()
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current).toMatchObject({ money: 'UTC', shell: 'UTC', plans: 'UTC' })
  })

  it('uses the profile zone when one is set', async () => {
    profile('Asia/Tokyo')
    const { result } = zones()
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current).toMatchObject({
      money: 'Asia/Tokyo',
      shell: 'Asia/Tokyo',
      plans: 'Asia/Tokyo',
    })
  })

  it('falls back to the device zone when the profile has none', async () => {
    profile(null)
    const { result } = zones()
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current).toMatchObject({ money: DEVICE, shell: DEVICE, plans: DEVICE })
  })
})
