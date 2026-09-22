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

/** FX rates are stored as numeric(18,8). */
const RATE_DECIMALS = 8
const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS)

function scaleRate(rate: number | string): bigint {
  const value = typeof rate === 'string' ? Number(rate) : rate
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`invalid fx rate: ${rate}`)
  const scaled = BigInt(Math.round(value * Number(RATE_SCALE)))
  if (scaled === 0n) throw new RangeError(`fx rate too small: ${rate}`)
  return scaled
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
 * 8 decimal places, like the `fx_rate numeric(18,8)` column.
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
