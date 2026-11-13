/**
 * The languages Potluck speaks. English is the source: every other language is a partial
 * translation of it, and any key it leaves out falls back to English.
 */
export const LOCALES = {
  en: { name: 'English', intl: 'en-US' },
  es: { name: 'Español', intl: 'es-ES' },
  fr: { name: 'Français', intl: 'fr-FR' },
  de: { name: 'Deutsch', intl: 'de-DE' },
  pt: { name: 'Português', intl: 'pt-BR' },
} as const

export type Locale = keyof typeof LOCALES

export const LOCALE_CODES = Object.keys(LOCALES) as Locale[]

export const SOURCE_LOCALE: Locale = 'en'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && Object.hasOwn(LOCALES, value)
}

/** The supported language for a BCP 47 tag ("es-MX" is Spanish), or null. */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null
  const base = tag.trim().toLowerCase().split(/[-_]/)[0]
  return isLocale(base) ? base : null
}

/**
 * A translation of `T`: the same nesting, every string optional. Used with `satisfies`, so a
 * key English does not have fails typecheck.
 */
export type Translation<T> = {
  readonly [K in keyof T]?: T[K] extends string ? string : Translation<T[K]>
}
