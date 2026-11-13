import { minorUnits, parseAmount } from '../currency'

/** Plain decimal for a spreadsheet cell: 1234 USD cents -> "12.34", 1500 JPY -> "1500". */
export function formatMinor(cents: number, currency: string): string {
  const digits = minorUnits(currency)
  if (digits === 0) return String(cents)
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const scale = 10 ** digits
  return `${sign}${Math.floor(abs / scale)}.${String(abs % scale).padStart(digits, '0')}`
}

/**
 * A decimal from a file ("12.34", "-7.5", "1,234.00", "1500.00" for yen) in minor units of
 * `currency`, or null when it is not a plain number or has more precision than the currency
 * (trailing zeros past it are fine). An empty cell is null too.
 */
export function parseMinor(text: string, currency: string): number | null {
  let value = text.trim()
  if (value === '') return null
  let sign = 1
  if (value.startsWith('-')) {
    sign = -1
    value = value.slice(1)
  } else if (value.startsWith('+')) {
    value = value.slice(1)
  }
  const dot = value.indexOf('.')
  if (dot !== -1) {
    const digits = minorUnits(currency)
    const fraction = value.slice(dot + 1)
    if (fraction.length > digits && /^0*$/.test(fraction.slice(digits))) {
      value = value.slice(0, dot + 1 + digits)
      if (value.endsWith('.')) value = value.slice(0, -1)
    }
  }
  const cents = parseAmount(value, currency)
  if (cents === null) return null
  return sign * cents || 0
}

/** "1.100000000000" -> "1.1", "1.000000000000" -> "1": a rate without its padding. */
export function trimRate(rate: string | number): string {
  const text = String(rate)
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}
