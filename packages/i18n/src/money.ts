import { minorUnits } from '@potluck/core'

export const DEFAULT_LOCALE = 'en-US'

export interface MoneyFormatOptions {
  locale?: string
  /** `symbol` (default) keeps CA$ and A$ distinct; `narrowSymbol` shows plain $. */
  currencyDisplay?: 'symbol' | 'narrowSymbol' | 'code' | 'name'
  signDisplay?: 'auto' | 'always' | 'exceptZero' | 'never'
}

const cache = new Map<string, Intl.NumberFormat>()

function formatter(currency: string, options: MoneyFormatOptions): Intl.NumberFormat {
  const locale = options.locale ?? DEFAULT_LOCALE
  const currencyDisplay = options.currencyDisplay ?? 'symbol'
  const signDisplay = options.signDisplay ?? 'auto'
  const key = `${locale}|${currency}|${currencyDisplay}|${signDisplay}`
  let format = cache.get(key)
  if (!format) {
    const digits = minorUnits(currency)
    format = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay,
      signDisplay,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
    cache.set(key, format)
  }
  return format
}

/**
 * Format an amount in minor units (cents, yen, fils). Always shows every minor digit
 * ($12.00, not $12) so amounts line up with tabular figures. Uses the same minor unit table as
 * `@potluck/core`, so JPY 1500 is 1,500 yen.
 */
export function formatMoney(
  amountMinor: number,
  currency: string,
  options: MoneyFormatOptions = {},
): string {
  const code = currency.toUpperCase()
  return formatter(code, options).format(amountMinor / 10 ** minorUnits(code))
}
