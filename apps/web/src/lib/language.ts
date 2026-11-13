import {
  currentLocale,
  isLocale,
  matchLocale,
  onLocaleChange,
  setLocale,
  SOURCE_LOCALE,
  type Locale,
} from '@potluck/i18n'
import { useSyncExternalStore } from 'react'

/**
 * The language on this device: remembered here so the first paint (and the signed out pages)
 * use it, and saved on the profile so it follows the person to other devices.
 */
const STORAGE_KEY = 'potluck.locale'

function remembered(): Locale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return isLocale(value) ? value : null
  } catch {
    return null
  }
}

/** The language to start in: the last one used here, else the browser's if we speak it. */
export function initialLocale(): Locale {
  if (typeof window === 'undefined') return SOURCE_LOCALE
  return remembered() ?? matchLocale(navigator.language) ?? SOURCE_LOCALE
}

/** Switch the whole app to `locale` and remember it on this device. */
export async function applyLanguage(locale: Locale): Promise<void> {
  await setLocale(locale)
  if (typeof document !== 'undefined') document.documentElement.lang = locale
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Private mode: the profile still remembers it.
  }
}

/** Starts the app in its language before the first render. English needs no download. */
export function startLanguage(): Promise<void> {
  const locale = initialLocale()
  if (locale === SOURCE_LOCALE) return Promise.resolve()
  return applyLanguage(locale).catch(() => undefined)
}

/** The active language; components that call it re-render when it changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(onLocaleChange, currentLocale, currentLocale)
}
