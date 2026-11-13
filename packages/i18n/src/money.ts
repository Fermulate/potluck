import { minorUnits } from '@potluck/core'
import { intlLocale } from './translate'

/** English as the app writes it; screens that must not follow the language (the landing demo). */
export const DEFAULT_LOCALE = 'en-US'

export interface MoneyFormatOptions {
  /** Intl tag; defaults to the active language (`setLocale`), so 12,50 € in German. */
  locale?: string
  /** `symbol` (default) keeps CA$ and A$ distinct; `narrowSymbol` shows plain $. */
  currencyDisplay?: 'symbol' | 'narrowSymbol' | 'code' | 'name'
  signDisplay?: 'auto' | 'always' | 'exceptZero' | 'never'
}

const cache = new Map<string, Intl.NumberFormat>()

function formatter(currency: string, options: MoneyFormatOptions): Intl.NumberFormat {
  const locale = options.locale ?? intlLocale()
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
  // `|| 0` folds -0 into 0, so a negated zero never formats as "-$0.00".
  return formatter(code, options).format((amountMinor || 0) / 10 ** minorUnits(code))
}

/**
 * An exchange rate kept as decimal text, shown with the language's decimal mark (1,09 in French)
 * and every digit it has: it is never rounded through a number.
 */
export function formatRate(rate: string, options: { locale?: string } = {}): string {
  const mark =
    new Intl.NumberFormat(options.locale ?? intlLocale())
      .formatToParts(1.5)
      .find((p) => p.type === 'decimal')?.value ?? '.'
  return rate.trim().replace('.', mark)
}
