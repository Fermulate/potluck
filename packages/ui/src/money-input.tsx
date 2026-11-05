import { ChevronDown } from 'lucide-react'
import { forwardRef, useState, type ChangeEvent } from 'react'
import { minorUnitScale } from './amount'
import { cn } from './cn'
import { useField } from './field'

function decimalSeparator(locale?: string): string {
  return (
    new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.'
  )
}

function currencySymbol(currency: string, locale?: string): string {
  return (
    new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((p) => p.type === 'currency')?.value ?? currency
  )
}

/**
 * Parses what someone typed into integer minor units. Accepts "." or the
 * locale separator, ignores grouping, and caps the fraction at the currency's
 * precision. Returns null for empty input.
 */
export function parseMoneyInput(text: string, currency: string, locale?: string): number | null {
  const sep = decimalSeparator(locale)
  const normalized = text.replace(sep, '.').replace(/[^\d.]/g, '')
  if (normalized === '' || normalized === '.') return null
  const [whole = '0', fraction = ''] = normalized.split('.')
  const scale = minorUnitScale(currency, locale)
  const digits = Math.round(Math.log10(scale))
  const frac = fraction.slice(0, digits).padEnd(digits, '0')
  return Number(whole || '0') * scale + Number(frac || '0')
}

function centsToText(cents: number | null, currency: string, locale?: string): string {
  if (cents === null) return ''
  const scale = minorUnitScale(currency, locale)
  const digits = Math.round(Math.log10(scale))
  const whole = Math.floor(cents / scale)
  const frac = cents % scale
  if (digits === 0 || frac === 0) return String(whole)
  return `${whole}${decimalSeparator(locale)}${String(frac).padStart(digits, '0')}`
}

/** Keeps only digits and a single separator, with at most `digits` decimals. */
function sanitize(raw: string, sep: string, digits: number): string {
  let out = ''
  let seenSep = false
  let fraction = 0
  for (const ch of raw.replace('.', sep)) {
    if (ch >= '0' && ch <= '9') {
      if (seenSep) {
        if (fraction >= digits) continue
        fraction++
      }
      out += ch
    } else if (ch === sep && !seenSep && digits > 0) {
      seenSep = true
      out += out === '' ? `0${sep}` : sep
    }
  }
  // No leading zeros like "007".
  return out.replace(/^0+(?=\d)/, '')
}

export interface MoneyInputProps {
  /** Integer minor units, or null when empty. */
  value: number | null
  onValueChange: (cents: number | null) => void
  currency: string
  locale?: string
  /** Accessible name when not inside a `Field`, e.g. "Amount". */
  label?: string
  /** Opens a currency picker. Without it the chip is static. */
  onCurrencyPress?: () => void
  /** Accessible name for the currency chip button, e.g. "Change currency, USD". */
  currencyButtonLabel?: string
  /** Largest allowed value in minor units. */
  max?: number
  autoFocus?: boolean
  size?: 'md' | 'lg'
  className?: string
}

/** Big, tabular amount entry with a currency chip. */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  {
    value,
    onValueChange,
    currency,
    locale,
    label,
    onCurrencyPress,
    currencyButtonLabel,
    max = 99_999_999_99,
    autoFocus,
    size = 'lg',
    className,
  },
  ref,
) {
  const field = useField()
  const sep = decimalSeparator(locale)
  const digits = Math.round(Math.log10(minorUnitScale(currency, locale)))
  const [text, setText] = useState(() => centsToText(value, currency, locale))
  const [lastValue, setLastValue] = useState(value)

  // Sync when the parent changes the value (reset, quick amounts).
  if (value !== lastValue) {
    setLastValue(value)
    if (value !== parseMoneyInput(text, currency, locale)) {
      setText(centsToText(value, currency, locale))
    }
  }

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = sanitize(e.target.value, sep, digits)
    const cents = parseMoneyInput(next, currency, locale)
    if (cents !== null && cents > max) return
    setText(next)
    setLastValue(cents)
    onValueChange(cents)
  }

  const symbol = currencySymbol(currency, locale)
  const chip = (
    <>
      <span className="text-base leading-none font-bold">{symbol}</span>
      <span className="text-xs font-semibold tracking-wide opacity-75">{currency}</span>
      {onCurrencyPress && <ChevronDown aria-hidden className="size-3.5 opacity-60" />}
    </>
  )
  const chipClass =
    'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill bg-saffron px-3 text-on-saffron'

  return (
    <div className={cn('flex items-center justify-center gap-3', className)}>
      {onCurrencyPress ? (
        <button
          type="button"
          onClick={onCurrencyPress}
          aria-label={currencyButtonLabel}
          className={cn(chipClass, 'transition-transform active:scale-95')}
        >
          {chip}
        </button>
      ) : (
        <span className={chipClass} aria-hidden>
          {chip}
        </span>
      )}
      <span className="inline-flex border-b-2 border-dashed border-transparent pb-1 transition-colors focus-within:border-ink/70">
        <input
          ref={ref}
          id={field?.id}
          aria-label={field ? undefined : label}
          aria-describedby={field?.describedBy}
          aria-invalid={field?.invalid || undefined}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          autoFocus={autoFocus}
          placeholder="0"
          value={text}
          onChange={onChange}
          style={{ width: `${Math.max(1, text.length) + 0.2}ch` }}
          className={cn(
            'min-w-[1.2ch] bg-transparent p-0 text-center leading-none font-extrabold tracking-tight text-ink tabular caret-tomato outline-none placeholder:text-line-strong',
            'focus-visible:outline-none',
            size === 'lg' ? 'text-6xl sm:text-7xl' : 'text-4xl',
          )}
        />
      </span>
    </div>
  )
})
