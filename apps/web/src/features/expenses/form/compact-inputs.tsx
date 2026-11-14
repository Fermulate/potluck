import { cn, parseDecimalInput, sanitizeDecimalInput, useMoneyText } from '@potluck/ui'
import { useState, type InputHTMLAttributes } from 'react'
import { formatPercent } from './split-state'

const inputClass =
  'h-11 w-full rounded-input border border-line-strong bg-card px-3 text-right text-base font-semibold tabular text-ink ' +
  'placeholder:font-normal placeholder:text-mute/70 transition-colors hover:border-ink/35 focus:border-ink focus-visible:outline-none ' +
  'aria-invalid:border-tomato'

/**
 * A small right-aligned money field for split rows and line items. Reads and writes text in
 * `locale`, the same as the main amount field, and redraws when the currency changes.
 */
export function CompactMoneyInput({
  value,
  onValueChange,
  currency,
  locale,
  className,
  ...props
}: {
  value: number | null
  onValueChange: (cents: number | null) => void
  currency: string
  locale: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const { text, onTextChange } = useMoneyText({ value, onValueChange, currency, locale })
  return (
    <input
      inputMode="decimal"
      autoComplete="off"
      placeholder="0"
      value={text}
      onChange={(e) => onTextChange(e.target.value)}
      className={cn(inputClass, className)}
      {...props}
    />
  )
}

/**
 * Percent typed with up to two decimals. Every keystroke is passed on as it reads, so the value
 * is always what is on screen, however fast the fields are filled; nothing else rebalances.
 */
export function PercentInput({
  basisPoints,
  onValueChange,
  locale,
  className,
  ...props
}: {
  basisPoints: number
  onValueChange: (basisPoints: number) => void
  locale: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  // Percent is two decimals, so the parsed units are basis points. Empty means 0%.
  const parse = (text: string) => parseDecimalInput(text, 2, locale) ?? 0
  const [text, setText] = useState<string | null>(null)
  // The text as typed ("50.", "" or "07") while it still means the value; a value set from
  // elsewhere (the slider, even it out) shows formatted instead.
  const shown =
    text !== null && parse(text) === basisPoints ? text : formatPercent(basisPoints, locale)
  return (
    <span className={cn('relative block', className)}>
      <input
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        value={shown}
        onChange={(e) => {
          const next = sanitizeDecimalInput(e.target.value, 2, locale)
          setText(next)
          onValueChange(parse(next))
        }}
        onBlur={() => setText(null)}
        className={cn(inputClass, 'pr-7')}
        {...props}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-mute"
      >
        %
      </span>
    </span>
  )
}

/**
 * A +/- amount for adjustment splits. Phone keypads often have no minus key, so the sign is a
 * toggle next to the field and the field holds the size of the adjustment.
 */
export function SignedMoneyInput({
  value,
  onValueChange,
  currency,
  locale,
  minusLabel,
  className,
  ...props
}: {
  value: number | null
  onValueChange: (cents: number | null) => void
  currency: string
  locale: string
  /** Accessible name of the sign toggle, pressed while the amount is taken off. */
  minusLabel: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [negative, setNegative] = useState((value ?? 0) < 0)
  const isNegative = value !== null && value !== 0 ? value < 0 : negative
  const magnitude = value === null ? null : Math.abs(value)
  const signed = (cents: number | null, minus: boolean) =>
    cents === null ? null : minus ? -cents : cents
  return (
    <span className={cn('flex items-center gap-1', className)}>
      <button
        type="button"
        aria-pressed={isNegative}
        aria-label={minusLabel}
        onClick={() => {
          setNegative(!isNegative)
          onValueChange(signed(magnitude, !isNegative))
        }}
        className={cn(
          'grid h-11 w-9 shrink-0 place-items-center rounded-input border text-lg leading-none font-bold transition-colors',
          isNegative
            ? 'border-tomato/40 bg-tomato-soft text-tomato-ink'
            : 'border-olive/40 bg-olive-soft text-olive-ink',
        )}
      >
        <span aria-hidden>{isNegative ? '−' : '+'}</span>
      </button>
      <CompactMoneyInput
        currency={currency}
        locale={locale}
        value={magnitude}
        onValueChange={(cents) => onValueChange(signed(cents, isNegative))}
        className="min-w-0 flex-1"
        {...props}
      />
    </span>
  )
}
