import { minorUnits } from '@potluck/core'
import { cn, parseMoneyInput } from '@potluck/ui'
import { useState, type InputHTMLAttributes } from 'react'

function toText(cents: number | null, currency: string): string {
  if (cents === null) return ''
  const digits = minorUnits(currency)
  if (digits === 0) return String(cents)
  const scale = 10 ** digits
  const frac = cents % scale
  return frac === 0
    ? String(Math.floor(cents / scale))
    : `${Math.floor(cents / scale)}.${String(frac).padStart(digits, '0')}`
}

const inputClass =
  'h-11 w-full rounded-input border border-line-strong bg-card px-3 text-right text-base font-semibold tabular text-ink ' +
  'placeholder:font-normal placeholder:text-mute/70 transition-colors hover:border-ink/35 focus:border-ink focus-visible:outline-none ' +
  'aria-invalid:border-tomato'

/** A small right-aligned money field for split rows and line items. */
export function CompactMoneyInput({
  value,
  onValueChange,
  currency,
  className,
  ...props
}: {
  value: number | null
  onValueChange: (cents: number | null) => void
  currency: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(() => toText(value, currency))
  const [last, setLast] = useState(value)
  if (value !== last) {
    setLast(value)
    if (value !== parseMoneyInput(text, currency)) setText(toText(value, currency))
  }
  return (
    <input
      inputMode="decimal"
      autoComplete="off"
      placeholder={toText(0, currency) || '0'}
      value={text}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d.,]/g, '')
        setText(raw)
        const cents = parseMoneyInput(raw, currency)
        setLast(cents)
        onValueChange(cents)
      }}
      className={cn(inputClass, className)}
      {...props}
    />
  )
}

/** Percent typed with up to two decimals, committed on blur or Enter (so others rebalance once). */
export function PercentInput({
  basisPoints,
  onCommit,
  className,
  ...props
}: {
  basisPoints: number
  onCommit: (basisPoints: number) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const shown = String(Math.round(basisPoints) / 100)
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const value = Number(draft.replace(',', '.'))
    setDraft(null)
    if (Number.isFinite(value)) onCommit(Math.round(value * 100))
  }
  return (
    <span className={cn('relative block', className)}>
      <input
        inputMode="decimal"
        autoComplete="off"
        value={draft ?? shown}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.,]/g, ''))}
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
