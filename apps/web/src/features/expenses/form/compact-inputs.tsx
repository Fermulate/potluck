import { cn, parseDecimalInput, sanitizeDecimalInput, useMoneyText } from '@potluck/ui'
import { useState, type InputHTMLAttributes } from 'react'

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

const percentText = new Map<string, Intl.NumberFormat>()
function formatPercent(basisPoints: number, locale: string): string {
  let f = percentText.get(locale)
  if (!f) {
    f = new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false })
    percentText.set(locale, f)
  }
  return f.format(Math.round(basisPoints) / 100)
}

/** Percent typed with up to two decimals, committed on blur or Enter (so others rebalance once). */
export function PercentInput({
  basisPoints,
  onCommit,
  locale,
  className,
  ...props
}: {
  basisPoints: number
  onCommit: (basisPoints: number) => void
  locale: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const shown = formatPercent(basisPoints, locale)
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    setDraft(null)
    // Percent is two decimals, so the parsed units are basis points. Empty means 0%.
    onCommit(parseDecimalInput(draft, 2, locale) ?? 0)
  }
  return (
    <span className={cn('relative block', className)}>
      <input
        inputMode="decimal"
        autoComplete="off"
        value={draft ?? shown}
        onChange={(e) => setDraft(sanitizeDecimalInput(e.target.value, 2, locale))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
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
