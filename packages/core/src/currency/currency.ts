/**
 * ISO 4217 currencies whose minor unit is not 2 digits. Everything else is assumed to use cents.
 * Amounts are always stored in the currency's minor unit (yen for JPY, fils for BHD).
 */
const MINOR_UNIT_EXCEPTIONS: Readonly<Record<string, number>> = {
  // zero decimals
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  // three decimals
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
}

/** Number of digits after the decimal point for `currency` (USD 2, JPY 0, BHD 3). */
export function minorUnits(currency: string): number {
  return MINOR_UNIT_EXCEPTIONS[currency.toUpperCase()] ?? 2
}

const AMOUNT_PATTERN = /^(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d*))?$/

/**
 * Parse a typed amount ("12.34", "1,234.5", ".99") into minor units of `currency`.
 * Returns null for empty, negative, malformed, too precise, or unsafe amounts.
 * Only "." is accepted as the decimal separator and "," as a thousands separator.
 */
export function parseAmount(input: string, currency: string): number | null {
  const match = AMOUNT_PATTERN.exec(input.trim())
  if (!match) return null
  const whole = (match[1] ?? '').replaceAll(',', '')
  const fraction = match[2] ?? ''
  if (whole === '' && fraction === '') return null

  const digits = minorUnits(currency)
  if (fraction.length > digits) return null
  const value = Number(whole || '0') * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0')
  return Number.isSafeInteger(value) ? value : null
}

/** FX rates are stored as numeric(24,12). */
const RATE_DECIMALS = 12
const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS)

/**
 * The rate as an integer number of 1e-12 units, rounded half up like a cast to numeric(24,12).
 * Works on the decimal text so large rates (16000.123456789012) keep every digit.
 */
function scaleRate(rate: number | string): bigint {
  const value = typeof rate === 'string' ? Number(rate) : rate
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`invalid fx rate: ${rate}`)
  const text =
    typeof rate === 'string' && /^\d+(\.\d+)?$/.test(rate.trim())
      ? rate.trim()
      : value.toFixed(RATE_DECIMALS)
  const [whole = '0', fraction = ''] = text.split('.')
  let scaled =
    BigInt(whole) * RATE_SCALE + BigInt(fraction.slice(0, RATE_DECIMALS).padEnd(RATE_DECIMALS, '0'))
  if ((fraction[RATE_DECIMALS] ?? '0') >= '5') scaled += 1n
  if (scaled === 0n) throw new RangeError(`fx rate too small: ${rate}`)
  return scaled
}

/**
 * `1 / rate` to 12 decimals, rounded half up, as decimal text: what `private.fx_rate` returns
 * for the inverse pair (`round(1 / rate, 12)`). Exact, so a large inverse such as
 * 17361.111111111111 keeps all 17 digits, which a JS number cannot.
 */
export function invertRate(rate: number | string): string {
  const scaled = scaleRate(rate)
  const numerator = RATE_SCALE * RATE_SCALE
  let inverse = numerator / scaled
  if ((numerator % scaled) * 2n >= scaled) inverse += 1n
  if (inverse === 0n) throw new RangeError(`fx rate too large to invert: ${rate}`)
  const whole = inverse / RATE_SCALE
  const fraction = (inverse % RATE_SCALE).toString().padStart(RATE_DECIMALS, '0')
  return `${whole}.${fraction}`
}

export interface ConvertOptions {
  /** Currency of `amountMinor`. Only its minor unit count matters. Defaults to a 2 digit currency. */
  from?: string
  /** Target currency. Only its minor unit count matters. Defaults to a 2 digit currency. */
  to?: string
}

/**
 * Convert an amount in minor units using `rate` (units of `to` per unit of `from`), returning
 * minor units of `to`.
 *
 * Rounding: half away from zero ("half up" for positive amounts), the same as Postgres
 * `round(numeric)`, so client previews match what the database stores. The rate is used with
 * 12 decimal places, like the `fx_rate numeric(24,12)` column.
 */
export function convert(
  amountMinor: number,
  rate: number | string,
  options: ConvertOptions = {},
): number {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`amount must be an integer: ${amountMinor}`)
  }
  const fromDigits = options.from ? minorUnits(options.from) : 2
  const toDigits = options.to ? minorUnits(options.to) : 2

  const magnitude = BigInt(Math.abs(amountMinor))
  const numerator = magnitude * scaleRate(rate) * 10n ** BigInt(toDigits)
  const denominator = RATE_SCALE * 10n ** BigInt(fromDigits)

  let result = numerator / denominator
  if ((numerator % denominator) * 2n >= denominator) result += 1n
  return amountMinor < 0 ? -Number(result) : Number(result)
}
