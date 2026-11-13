import { afterEach, describe, expect, it, vi } from 'vitest'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import {
  activateLocale,
  currentLocale,
  formatDate,
  formatMoney,
  intlLocale,
  isLocale,
  localDateFormat,
  LOCALE_CODES,
  matchLocale,
  onLocaleChange,
  setLocale,
  t,
  type Translation,
} from './index'
import type { Dictionary } from './en'
import { pt } from './pt'

function leaves(node: object, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out.set(path, value)
    else for (const [k, v] of leaves(value as object, path)) out.set(k, v)
  }
  return out
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`)

/**
 * How much of English each language must cover. A new English key may land before its
 * translations (it shows in English meanwhile), so this leaves room for a few; the failure
 * message lists what is missing.
 */
const MIN_COVERAGE = 0.97

afterEach(async () => {
  await setLocale('en')
})

describe('locale codes', () => {
  it('knows the supported languages', () => {
    expect(LOCALE_CODES).toEqual(['en', 'es', 'fr', 'de', 'pt'])
    expect(isLocale('de')).toBe(true)
    expect(isLocale('ja')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
  })

  it('matches a browser tag to a supported language', () => {
    expect(matchLocale('es-MX')).toBe('es')
    expect(matchLocale('EN_gb')).toBe('en')
    expect(matchLocale('pt-PT')).toBe('pt')
    expect(matchLocale('ja-JP')).toBeNull()
    expect(matchLocale('')).toBeNull()
    expect(matchLocale(null)).toBeNull()
  })
})

describe('switching language', () => {
  it('answers in Spanish after setLocale and in English again after switching back', async () => {
    await setLocale('es')
    expect(currentLocale()).toBe('es')
    expect(intlLocale()).toBe('es-ES')
    expect(t('security.language.label')).toBe(es.security.language.label)
    await setLocale('en')
    expect(t('security.language.label')).toBe('Language')
    expect(intlLocale()).toBe('en-US')
  })

  it('loads every language', async () => {
    for (const [code, dict] of [
      ['fr', fr],
      ['de', de],
      ['pt', pt],
    ] as const) {
      await setLocale(code)
      expect(t('nav.home')).toBe(dict.nav.home)
    }
  })

  it('falls back to English for a key the translation leaves out', () => {
    activateLocale('es', { app: { name: 'Potluck ES' } })
    expect(t('app.name')).toBe('Potluck ES')
    expect(t('common.save')).toBe(en.common.save)
  })

  it('picks plurals and formats numbers by the active language', () => {
    activateLocale('es', {
      groups: { memberCount_one: '{count} miembro', memberCount_other: '{count} miembros' },
    })
    expect(t('groups.memberCount', { count: 1 })).toBe('1 miembro')
    expect(t('groups.memberCount', { count: 2.5 })).toBe('2,5 miembros')
  })

  it('formats dates and money in the active language unless told otherwise', async () => {
    const weekday = localDateFormat({ weekday: 'long', timeZone: 'UTC' })
    const friday = new Date('2026-06-12T12:00:00Z')
    expect(weekday.format(friday)).toBe('Friday')
    expect(formatMoney(123456, 'EUR')).toBe('€1,234.56')
    await setLocale('de')
    expect(weekday.format(friday)).toBe('Freitag')
    expect(formatMoney(123456, 'EUR').replace(/\s/g, ' ')).toBe('1.234,56 €')
    expect(formatMoney(123456, 'EUR', { locale: 'en-US' })).toBe('€1,234.56')
    await setLocale('es')
    expect(formatDate('2026-06-12', { timeZone: 'UTC', style: 'long' })).toBe('12 de junio de 2026')
    expect(formatDate('2026-06-12', { timeZone: 'UTC', style: 'long', locale: 'en-US' })).toBe(
      'June 12, 2026',
    )
  })

  it('tells listeners once per actual change', async () => {
    const listener = vi.fn()
    const off = onLocaleChange(listener)
    await setLocale('es')
    await setLocale('es')
    await setLocale('en')
    off()
    await setLocale('es')
    expect(listener.mock.calls).toEqual([['es'], ['en']])
  })

  it('lets the last of two overlapping switches win', async () => {
    const slow = setLocale('es')
    const fast = setLocale('en')
    await Promise.all([slow, fast])
    expect(currentLocale()).toBe('en')
  })
})

const english = leaves(en)
const translations: [string, Translation<Dictionary>][] = [
  ['es', es],
  ['fr', fr],
  ['de', de],
  ['pt', pt],
]

describe.each(translations)('the %s dictionary', (_code, dictionary) => {
  const strings = leaves(dictionary)

  it(`covers at least ${MIN_COVERAGE * 100}% of the English keys`, () => {
    const missing = [...english.keys()].filter((key) => !strings.has(key))
    const coverage = 1 - missing.length / english.size
    expect(coverage, `missing: ${missing.join(', ')}`).toBeGreaterThanOrEqual(MIN_COVERAGE)
  })

  it('only uses keys English has', () => {
    expect([...strings.keys()].filter((key) => !english.has(key))).toEqual([])
  })

  it('keeps every placeholder of the English text', () => {
    const off = [...strings]
      .filter(([key, text]) => {
        const source = english.get(key)
        return source !== undefined && placeholders(source).join() !== placeholders(text).join()
      })
      .map(([key]) => key)
    expect(off).toEqual([])
  })

  it('never uses em or en dashes and has no blank strings', () => {
    const offenders = [...strings]
      .filter(([, text]) => DASHES.test(text) || text.trim() === '')
      .map(([key]) => key)
    expect(offenders).toEqual([])
  })

  it('uses {count} in every plural _other form', () => {
    const missing = [...strings]
      .filter(([key, text]) => key.endsWith('_other') && !text.includes('{count}'))
      .map(([key]) => key)
    expect(missing).toEqual([])
  })
})
