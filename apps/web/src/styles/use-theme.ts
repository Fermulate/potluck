import { useCallback, useSyncExternalStore } from 'react'
import type { ThemeName } from '@potluck/tokens'
import {
  getThemePreference,
  resolveTheme,
  setThemePreference,
  subscribeTheme,
  type ThemePreference,
} from './theme-preference'

/** Current preference (light, dark or system), the resolved theme, and a setter. */
export function useTheme(): {
  preference: ThemePreference
  resolved: ThemeName
  setPreference: (preference: ThemePreference) => void
} {
  const preference = useSyncExternalStore<ThemePreference>(
    subscribeTheme,
    getThemePreference,
    () => 'system',
  )
  const resolved = useSyncExternalStore(
    subscribeTheme,
    () => resolveTheme(getThemePreference()),
    () => 'light' as const,
  )
  const setPreference = useCallback((next: ThemePreference) => setThemePreference(next), [])
  return { preference, resolved, setPreference }
}
