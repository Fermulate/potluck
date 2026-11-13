import type { Dictionary } from './en'
import type { Locale, Translation } from './locales'
import { activateLocale, currentLocale } from './translate'

/** English ships with every screen; other languages download the first time they are used. */
const loaders: Record<Exclude<Locale, 'en'>, () => Promise<Translation<Dictionary>>> = {
  es: () => import('./es').then((m) => m.es),
}

let latest = 0

/**
 * Load `locale` and make it the active language. When calls overlap, the last one wins, so a
 * slow download can never undo a later choice.
 */
export async function setLocale(locale: Locale): Promise<void> {
  const ticket = ++latest
  const translation = locale === 'en' ? undefined : await loaders[locale]()
  if (ticket !== latest || (locale === currentLocale() && !translation)) return
  activateLocale(locale, translation)
}
