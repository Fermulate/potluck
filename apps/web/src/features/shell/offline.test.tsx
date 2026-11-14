import { t } from '@potluck/i18n'
import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { goOffline, goOnline } from '@/test/network'
import { useWarnBeforeUnload } from '@/lib/online'
import { OfflineBanner, OfflineSaveNote } from './offline'

afterEach(() => goOnline())

describe('OfflineBanner', () => {
  it('appears while offline and goes away when the connection is back', () => {
    render(<OfflineBanner />)
    expect(screen.queryByText(t('app.offline.banner'))).toBeNull()

    act(() => goOffline())
    expect(screen.getByRole('status')).toHaveTextContent(t('app.offline.banner'))

    act(() => goOnline())
    expect(screen.queryByText(t('app.offline.banner'))).toBeNull()
  })

  it('shows at once when the app opens offline', () => {
    goOffline()
    render(<OfflineBanner />)
    expect(screen.getByText(t('app.offline.banner'))).toBeInTheDocument()
  })
})

describe('OfflineSaveNote', () => {
  it('says the entry waits while offline, and that a paused save goes through later', () => {
    const { rerender } = render(<OfflineSaveNote />)
    expect(screen.getByRole('status')).toHaveTextContent('')
    act(() => goOffline())
    expect(screen.getByRole('status')).toHaveTextContent(t('app.offline.form'))
    rerender(<OfflineSaveNote paused />)
    expect(screen.getByRole('status')).toHaveTextContent(t('app.offline.paused'))
  })
})

describe('useWarnBeforeUnload', () => {
  const leave = () => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }

  it('asks before the tab closes only while active', () => {
    const { rerender, unmount } = renderHook(({ active }) => useWarnBeforeUnload(active), {
      initialProps: { active: false },
    })
    expect(leave()).toBe(false)
    rerender({ active: true })
    expect(leave()).toBe(true)
    unmount()
    expect(leave()).toBe(false)
  })
})
