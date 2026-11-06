import { minorUnits } from '@potluck/core'
import { ChevronDown } from 'lucide-react'
import { forwardRef, useState, type ChangeEvent } from 'react'
import { cn } from './cn'
import { formatDecimalInput, parseDecimalInput, sanitizeDecimalInput } from './decimal-input'
import { useField } from './field'

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
  return parseDecimalInput(text, minorUnits(currency), locale)
}

/** Editable text for an amount in minor units, e.g. "12.50" or "12,50" in German. */
export function formatMoneyInput(cents: number | null, currency: string, locale?: string): string {
  return formatDecimalInput(cents, minorUnits(currency), locale)
}

export interface MoneyTextOptions {
  value: number | null
  onValueChange: (cents: number | null) => void
  currency: string
  locale?: string
  /** Largest allowed value in minor units. */
  max?: number
}

/**
 * The text state behind a money field. Typing is sanitized for the locale and currency, parent
 * updates are followed, and the text is redrawn when the currency or locale changes (the minor
 * units stay put).
 */
export function useMoneyText({ value, onValueChange, currency, locale, max }: MoneyTextOptions) {
  const digits = minorUnits(currency)
  const [text, setText] = useState(() => formatMoneyInput(value, currency, locale))
  const [lastValue, setLastValue] = useState(value)
  const format = `${currency}|${locale ?? ''}`
  const [lastFormat, setLastFormat] = useState(format)

  if (format !== lastFormat) {
    setLastFormat(format)
    setLastValue(value)
    setText(formatMoneyInput(value, currency, locale))
  } else if (value !== lastValue) {
    // Sync when the parent changes the value (reset, quick amounts).
    setLastValue(value)
    if (value !== parseMoneyInput(text, currency, locale)) {
      setText(formatMoneyInput(value, currency, locale))
    }
  }

  const onTextChange = (raw: string) => {
    const next = sanitizeDecimalInput(raw, digits, locale)
    const cents = parseMoneyInput(next, currency, locale)
    if (cents !== null && max !== undefined && cents > max) return
    setText(next)
    setLastValue(cents)
    onValueChange(cents)
  }

  return { text, onTextChange }
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
  const { text, onTextChange } = useMoneyText({ value, onValueChange, currency, locale, max })
  const onChange = (e: ChangeEvent<HTMLInputElement>) => onTextChange(e.target.value)

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
    <div className={cn('@container flex items-center justify-center gap-3', className)}>
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
          style={{
            width: `${Math.max(1, text.length) + 0.2}ch`,
            // Shrink to fit the container as the number gets longer.
            fontSize: `min(${size === 'lg' ? 5 : 2.25}rem, calc((100cqi - 6.5rem) / ${(
              Math.max(3, text.length) * 0.56
            ).toFixed(2)}))`,
          }}
          className={cn(
            'min-w-[1.2ch] bg-transparent p-0 text-center leading-none font-extrabold tracking-tight text-ink tabular caret-tomato outline-none placeholder:text-line-strong',
            'focus-visible:outline-none',
          )}
        />
      </span>
    </div>
  )
})
