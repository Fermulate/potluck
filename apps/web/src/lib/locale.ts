import { CURRENCIES_IN_USE } from '@potluck/core'
import { intlLocale } from '@potluck/i18n'

/** Currencies offered first in pickers. The rest of the ones in use follow. */
const COMMON = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'MXN', 'CHF', 'SEK', 'NZD', 'SGD']

/**
 * Currencies a picker offers: the common ones, then every ISO 4217 currency in use. Not
 * `Intl.supportedValuesOf`, which also lists withdrawn currencies and codes like XDR.
 */
export function currencyCodes(): string[] {
  return [...COMMON, ...CURRENCIES_IN_USE.filter((c) => !COMMON.includes(c))]
}

/** Dash characters some browsers put in names ("Leone (1964\u20142022)"); copy uses none. */
const DASHES = /[\u2010-\u2015\u2212]/g

/** "EUR (Euro)", with the name in the app's language. */
export function currencyLabel(code: string): string {
  try {
    const name = new Intl.DisplayNames([intlLocale()], { type: 'currency' })
      .of(code)
      ?.replace(DASHES, '-')
    return name && name !== code ? `${code} (${name})` : code
  } catch {
    return code
  }
}

/**
 * The zone to render times in: the profile's when it has one (UTC included, someone may pick
 * it on purpose), otherwise the device's. Every screen resolves the zone through this.
 */
export function resolveTimeZone(profileZone: string | null | undefined): string {
  return profileZone || detectTimezone()
}

export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

let cachedZones: string[] | null = null

export function timezones(): string[] {
  if (cachedZones) return cachedZones
  try {
    cachedZones = Intl.supportedValuesOf('timeZone')
  } catch {
    cachedZones = ['UTC']
  }
  if (!cachedZones.includes('UTC')) cachedZones = ['UTC', ...cachedZones]
  return cachedZones
}

/** A best guess at a currency for a new account, from the browser locale. */
export function guessCurrency(): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region
    const byRegion: Record<string, string> = {
      US: 'USD',
      GB: 'GBP',
      CA: 'CAD',
      AU: 'AUD',
      NZ: 'NZD',
      JP: 'JPY',
      IN: 'INR',
      MX: 'MXN',
      CH: 'CHF',
      SE: 'SEK',
      SG: 'SGD',
    }
    const euro = ['DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'AT', 'PT', 'IE', 'FI', 'GR']
    if (region && euro.includes(region)) return 'EUR'
    return (region && byRegion[region]) || 'USD'
  } catch {
    return 'USD'
  }
}
