import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  initTheme,
  readThemePreference,
  setThemePreference,
  subscribeTheme,
  THEME_STORAGE_KEY,
} from './theme-preference'
import { installTokens } from './tokens'

function mockSystem(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: dark && query.includes('dark'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
  mockSystem(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('theme preference', () => {
  it('defaults to system and follows the OS', () => {
    mockSystem(true)
    initTheme()
    expect(readThemePreference()).toBe('system')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('persists an explicit choice and applies it', () => {
    setThemePreference('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    setThemePreference('system')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('ignores garbage in storage', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'neon')
    expect(readThemePreference()).toBe('system')
  })

  it('still applies the theme when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => setThemePreference('dark')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(readThemePreference()).toBe('system')
  })

  it('notifies subscribers', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeTheme(listener)
    setThemePreference('light')
    expect(listener).toHaveBeenCalledWith('light', 'light')
    unsubscribe()
  })
})

describe('installTokens', () => {
  it('injects one stylesheet with both themes', () => {
    installTokens()
    installTokens()
    const styles = document.querySelectorAll('style#pl-tokens')
    expect(styles).toHaveLength(1)
    const css = styles[0]?.textContent ?? ''
    expect(css).toContain('--pl-paper: #fbf5ea')
    expect(css).toContain('--pl-paper: #14110e')
  })
})
