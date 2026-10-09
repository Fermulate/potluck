import { themes, type ThemeName } from '@potluck/tokens'

export type ThemePreference = ThemeName | 'system'

export const THEME_STORAGE_KEY = 'potluck.theme'
const PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system']

type Listener = (resolved: ThemeName, preference: ThemePreference) => void
const listeners = new Set<Listener>()

function isPreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (PREFERENCES as readonly string[]).includes(value)
}

/** Reads the saved preference. Storage can throw (private mode, blocked cookies). */
export function readThemePreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isPreference(value) ? value : 'system'
  } catch {
    return 'system'
  }
}

function writeThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY)
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Not persisted, still applied for this session.
  }
}

function systemTheme(): ThemeName {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function resolveTheme(preference: ThemePreference): ThemeName {
  return preference === 'system' ? systemTheme() : preference
}

function applyResolved(resolved: ThemeName): void {
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = themes[resolved].colors.paper
}

let current: ThemePreference = 'system'

/** Applies and persists a preference, then notifies subscribers. */
export function setThemePreference(preference: ThemePreference): void {
  current = preference
  writeThemePreference(preference)
  const resolved = resolveTheme(preference)
  applyResolved(resolved)
  listeners.forEach((listener) => listener(resolved, preference))
}

export function getThemePreference(): ThemePreference {
  return current
}

export function subscribeTheme(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

let started = false

/**
 * Applies the saved preference and follows OS changes while on "system".
 * Safe to call more than once.
 */
export function initTheme(): void {
  current = readThemePreference()
  applyResolved(resolveTheme(current))
  if (started) return
  started = true
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (current === 'system') setThemePreference('system')
    })
  } catch {
    // Older browsers without matchMedia listeners keep the initial theme.
  }
}
