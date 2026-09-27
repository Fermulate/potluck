import { durations } from '@potluck/tokens'
import { animate } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { cn } from './cn'
import { usePrefersReducedMotion } from './hooks'

export type AmountSign = 'auto' | 'always' | 'exceptZero' | 'never'
export type AmountTone = 'auto' | 'neutral' | 'inherit' | 'owe' | 'owed' | 'settled'
export type AmountSurface = 'default' | 'hero'

const formatters = new Map<string, Intl.NumberFormat>()

function formatter(currency: string, locale: string | undefined, sign: AmountSign) {
  const key = `${locale ?? ''}|${currency}|${sign}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: 'currency', currency, signDisplay: sign })
    formatters.set(key, f)
  }
  return f
}

/** Minor units per major unit for a currency (USD 100, JPY 1, KWD 1000). */
export function minorUnitScale(currency: string, locale?: string): number {
  return 10 ** (formatter(currency, locale, 'auto').resolvedOptions().maximumFractionDigits ?? 2)
}

/** Formats integer minor units (cents) with the currency, using a true minus sign. */
export function formatMoney(
  cents: number,
  currency: string,
  { locale, sign = 'auto' }: { locale?: string; sign?: AmountSign } = {},
): string {
  return formatter(currency, locale, sign)
    .format(cents / minorUnitScale(currency, locale))
    .replace('-', '−')
}

const toneClass: Record<AmountSurface, Record<'owe' | 'owed' | 'settled' | 'neutral', string>> = {
  default: {
    owe: 'text-tomato-ink',
    owed: 'text-saffron-ink',
    settled: 'text-olive-ink',
    neutral: 'text-ink',
  },
  hero: {
    owe: 'text-tomato',
    owed: 'text-saffron',
    settled: 'text-olive',
    neutral: 'text-on-hero',
  },
}

export interface AmountProps {
  /** Integer minor units (cents). Positive means you are owed. */
  cents: number
  currency: string
  locale?: string
  /** How to show the sign. `auto` shows minus only. */
  sign?: AmountSign
  /** `auto` colors by sign: negative = owe (tomato), positive = owed (saffron). */
  tone?: AmountTone
  /** Use on the balance hero so colors stay legible on its surface. */
  surface?: AmountSurface
  /** Shrinks the currency symbol and cents so the whole number leads. */
  split?: boolean
  /** Tick up from 0 (or from the previous value) when the value changes. */
  countUp?: boolean
  /** Overrides the screen reader text, e.g. "You are owed $42.00". */
  srLabel?: string
  className?: string
}

function useCountUp(target: number, enabled: boolean): number {
  const reduced = usePrefersReducedMotion()
  const [shown, setShown] = useState(enabled && !reduced ? 0 : target)
  const from = useRef(shown)
  useEffect(() => {
    if (!enabled || reduced) {
      from.current = target
      return
    }
    const controls = animate(from.current, target, {
      duration: durations.countUp / 1000,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        // Interrupted counts resume from wherever the digits are.
        from.current = Math.round(v)
        setShown(from.current)
      },
    })
    return () => controls.stop()
  }, [target, enabled, reduced])
  return enabled && !reduced ? shown : target
}

/**
 * A money amount in tabular figures. The visible digits are hidden from
 * assistive tech; a single label with the currency is announced instead.
 */
export function Amount({
  cents,
  currency,
  locale,
  sign = 'auto',
  tone = 'auto',
  surface = 'default',
  split = false,
  countUp = false,
  srLabel,
  className,
}: AmountProps) {
  const value = useCountUp(cents, countUp)
  const f = formatter(currency, locale, sign)
  const scale = minorUnitScale(currency, locale)
  const parts = f.formatToParts(value / scale)
  const resolvedTone =
    tone === 'auto'
      ? cents < 0
        ? 'owe'
        : cents > 0
          ? 'owed'
          : 'neutral'
      : tone === 'inherit'
        ? null
        : tone
  const label = srLabel ?? formatMoney(cents, currency, { locale, sign })

  return (
    <span
      className={cn(
        'inline-flex items-baseline whitespace-nowrap tabular',
        resolvedTone && toneClass[surface][resolvedTone],
        className,
      )}
      data-tone={resolvedTone ?? 'inherit'}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden className="inline-flex items-baseline">
        {parts.map((part, i) => {
          if (part.type === 'minusSign') return <span key={i}>{'−'}</span>
          if (split && part.type === 'currency')
            return (
              <span
                key={i}
                className="mr-[0.04em] self-start text-[0.5em] leading-[1.6] opacity-80"
              >
                {part.value}
              </span>
            )
          if (split && (part.type === 'decimal' || part.type === 'fraction'))
            return (
              <span key={i} className="text-[0.5em] opacity-80">
                {part.value}
              </span>
            )
          return <span key={i}>{part.value}</span>
        })}
      </span>
    </span>
  )
}
