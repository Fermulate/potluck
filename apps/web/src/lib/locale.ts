/** Currencies offered first in pickers. Anything else from Intl follows. */
const COMMON = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'MXN', 'CHF', 'SEK', 'NZD', 'SGD']

let cachedCurrencies: string[] | null = null

export function currencyCodes(): string[] {
  if (cachedCurrencies) return cachedCurrencies
  let all: string[]
  try {
    all = Intl.supportedValuesOf('currency')
  } catch {
    all = []
  }
  const rest = all.filter((c) => !COMMON.includes(c))
  cachedCurrencies = [...COMMON, ...rest]
  return cachedCurrencies
}

export function currencyLabel(code: string): string {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'currency' }).of(code)
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
