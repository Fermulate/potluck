import { formatMoney, t } from '@potluck/i18n'
import { Card, cn, usePrefersReducedMotion } from '@potluck/ui'
import { Link, type LinkProps } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { monthLabel, monthShort } from './months'

/**
 * Charts for totals: plain DOM, no chart library, so they cost nothing to download and stay
 * smooth on a phone. One series each, drawn in plum; text stays in ink and mute. Every chart has
 * a table twin behind "Show as a table", and every mark can be reached by keyboard.
 */

/** A titled card with an optional control on the right and a table view underneath. */
export function ChartCard({
  title,
  action,
  table,
  children,
  className,
}: {
  title: string
  action?: ReactNode
  table?: ReactNode
  children: ReactNode
  className?: string
}) {
  const id = useId()
  return (
    <Card asChild padding="roomy">
      <section aria-labelledby={id} className={cn('flex flex-col gap-4', className)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={id} className="text-lg font-bold tracking-tight">
            {title}
          </h2>
          {action}
        </div>
        {children}
        {table && <TableToggle>{table}</TableToggle>}
      </section>
    </Card>
  )
}

function TableToggle({ children }: { children: ReactNode }) {
  return (
    <details className="group -mx-1 border-t border-line pt-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-pill px-1 text-sm font-semibold text-mute hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronDown
          aria-hidden
          className="size-4 transition-transform duration-150 group-open:rotate-180"
        />
        {t('insights.table.show')}
      </summary>
      <div className="mt-2 overflow-x-auto px-1">{children}</div>
    </details>
  )
}

/** A two column table: what, and how much. */
export function DataTable({
  caption,
  head,
  rows,
}: {
  caption: string
  head: [string, string]
  rows: { key: string; label: ReactNode; amount: string }[]
}) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="text-left text-mute">
          <th scope="col" className="py-1.5 font-semibold">
            {head[0]}
          </th>
          <th scope="col" className="py-1.5 text-right font-semibold">
            {head[1]}
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row" className="py-1.5 text-left font-normal">
              {row.label}
            </th>
            <td className="py-1.5 text-right tabular-nums">{row.amount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export interface MonthValue {
  month: string
  cents: number
}

const PLOT_HEIGHT = 144

/**
 * Columns per month, one series. Arrow keys walk the months (Home and End jump), Enter or a tap
 * picks one; the picked month carries its value on the cap, the others show theirs on hover and
 * focus, and all of them are in the table.
 */
export function MonthColumns({
  data,
  currency,
  selected,
  onSelect,
  measureLabel,
}: {
  data: MonthValue[]
  currency: string
  selected?: string | null
  onSelect?: (month: string) => void
  /** "Your share" or "Everyone", for the summary sentence. */
  measureLabel: string
}) {
  const reduced = usePrefersReducedMotion()
  const summaryId = useId()
  const scroller = useRef<HTMLDivElement>(null)
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = data.findIndex((d) => d.month === selected)
  // The one column in the tab order: the last one focused, else the picked month, else the latest.
  const [focused, setFocusIndex] = useState<number | null>(null)
  const focusIndex =
    focused !== null && focused < data.length
      ? focused
      : selectedIndex >= 0
        ? selectedIndex
        : data.length - 1
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(0, ...data.map((d) => d.cents))
  const money = (cents: number) => formatMoney(cents, currency)

  const dense = data.length > 12

  // Long histories scroll sideways; start at the picked month (or the latest).
  useEffect(() => {
    const el = scroller.current
    const target = buttons.current[selectedIndex >= 0 ? selectedIndex : data.length - 1]
    if (!dense || !el || !target || el.scrollWidth <= el.clientWidth) return
    el.scrollLeft = Math.max(0, target.offsetLeft - el.clientWidth / 2)
  }, [dense, selectedIndex, data.length])

  if (data.length === 0) return null

  const peak = data.reduce((best, d) => (d.cents > best.cents ? d : best), data[0]!)
  const summary =
    max === 0
      ? t('insights.byMonth.summaryEmpty')
      : t('insights.byMonth.summary', {
          measure: measureLabel,
          first: monthLabel(data[0]!.month),
          last: monthLabel(data[data.length - 1]!.month),
          max: money(peak.cents),
          maxMonth: monthLabel(peak.month),
        })

  const move = (e: KeyboardEvent, index: number) => {
    let next: number | null = null
    if (e.key === 'ArrowRight') next = Math.min(index + 1, data.length - 1)
    else if (e.key === 'ArrowLeft') next = Math.max(index - 1, 0)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = data.length - 1
    if (next === null) return
    e.preventDefault()
    setFocusIndex(next)
    buttons.current[next]?.focus()
  }

  const labelEvery = data.length <= 12 ? 1 : data.length <= 24 ? 2 : 3

  return (
    <figure className="m-0">
      <p id={summaryId} className="sr-only">
        {summary}
      </p>
      <div className="relative">
        {/* Top gridline with the scale, and the baseline. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-end border-t border-line"
        >
          <span className="-mt-px bg-card pl-1.5 text-[0.6875rem] leading-4 text-mute tabular-nums">
            {money(max)}
          </span>
        </div>
        <div
          ref={scroller}
          role="group"
          aria-label={t('insights.byMonth.title')}
          aria-describedby={summaryId}
          className="[scrollbar-width:none] overflow-x-auto"
        >
          <ol
            className={cn('flex items-stretch', dense ? 'min-w-max gap-1' : 'gap-1.5')}
            style={{ paddingTop: 20 }}
          >
            {data.map((d, i) => {
              const height =
                max > 0 ? Math.max(d.cents > 0 ? 3 : 0, (d.cents / max) * PLOT_HEIGHT) : 0
              const isSelected = d.month === selected
              const showValue = isSelected || hover === i
              const label = t('insights.byMonth.column', {
                month: monthLabel(d.month),
                amount: money(d.cents),
              })
              return (
                <li
                  key={d.month}
                  className={cn('flex flex-col items-center', dense ? 'w-8' : 'min-w-0 flex-1')}
                >
                  <button
                    ref={(el) => {
                      buttons.current[i] = el
                    }}
                    type="button"
                    tabIndex={i === focusIndex ? 0 : -1}
                    aria-label={label}
                    aria-pressed={onSelect ? isSelected : undefined}
                    onClick={() => onSelect?.(d.month)}
                    onKeyDown={(e) => move(e, i)}
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover((h) => (h === i ? null : h))}
                    onFocus={() => {
                      setFocusIndex(i)
                      setHover(i)
                    }}
                    onBlur={() => setHover((h) => (h === i ? null : h))}
                    className="group relative flex w-full flex-col items-center justify-end rounded-[0.5rem] outline-offset-2"
                    style={{ height: PLOT_HEIGHT + 4 }}
                  >
                    {showValue && (
                      <span
                        aria-hidden
                        className={cn(
                          'pointer-events-none absolute z-10 rounded-pill px-2 py-0.5 text-[0.6875rem] leading-4 font-bold whitespace-nowrap tabular-nums',
                          // Keep the value inside the chart at either end.
                          i >= data.length - 2 ? 'right-0' : i <= 1 ? 'left-0' : '',
                          isSelected && hover !== i
                            ? 'bg-card text-ink ring-1 ring-line'
                            : 'bg-ink text-paper shadow-pop',
                        )}
                        style={{ bottom: height + 6 }}
                      >
                        {money(d.cents)}
                      </span>
                    )}
                    <motion.span
                      aria-hidden
                      className={cn(
                        'block w-full max-w-6 origin-bottom rounded-t-[4px] transition-[filter] duration-150 group-hover:brightness-110',
                        isSelected ? 'bg-plum' : 'bg-plum/70',
                        d.cents === 0 && 'bg-line-strong',
                      )}
                      style={{ height: d.cents === 0 ? 1 : height }}
                      initial={reduced ? false : { scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={
                        reduced
                          ? { duration: 0 }
                          : {
                              type: 'spring',
                              stiffness: 380,
                              damping: 32,
                              delay: Math.min(i, 12) * 0.03,
                            }
                      }
                    />
                  </button>
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1.5 h-4 text-[0.6875rem] leading-4 whitespace-nowrap tabular-nums',
                      isSelected ? 'font-bold text-ink' : 'text-mute',
                      // Past six months the labels do not fit side by side on a phone: every other one.
                      data.length > 6 && !dense && !isSelected && i % 2 === 1 && 'max-sm:invisible',
                    )}
                  >
                    {i % labelEvery === 0 || isSelected ? monthShort(d.month) : ''}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'h-1 w-4 rounded-pill',
                      isSelected ? 'bg-saffron' : 'bg-transparent',
                    )}
                  />
                </li>
              )
            })}
          </ol>
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 border-t border-line-strong"
          style={{ top: PLOT_HEIGHT + 24 }}
        />
      </div>
    </figure>
  )
}

export interface BarDatum {
  key: string
  label: ReactNode
  /** Plain text name, for the accessible label. */
  name: string
  cents: number
  link?: LinkProps
}

/**
 * Horizontal bars, largest first, each labeled with its name, amount and share of the total.
 * The values are all printed, so this doubles as its own table.
 */
export function BarList({
  data,
  currency,
  label,
}: {
  data: BarDatum[]
  currency: string
  label: string
}) {
  const reduced = usePrefersReducedMotion()
  const max = Math.max(0, ...data.map((d) => d.cents))
  const total = data.reduce((sum, d) => sum + d.cents, 0)
  return (
    <ol aria-label={label} className="flex flex-col gap-3.5">
      {data.map((d, i) => {
        const pct = total > 0 ? Math.round((d.cents / total) * 100) : 0
        const amount = formatMoney(d.cents, currency)
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-[0.9375rem] font-semibold">
                {d.label}
              </span>
              <span className="sr-only">, </span>
              <span className="shrink-0 text-[0.9375rem] font-bold tabular-nums">{amount}</span>
            </span>
            <span className="mt-1.5 flex items-center gap-3">
              <span
                aria-hidden
                className="relative h-2 flex-1 overflow-hidden rounded-r-[4px] bg-sunken"
              >
                <motion.span
                  className="absolute inset-y-0 left-0 rounded-r-[4px] bg-plum"
                  style={{ width: `${max > 0 ? Math.max(1, (d.cents / max) * 100) : 0}%` }}
                  initial={reduced ? false : { scaleX: 0, originX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={
                    reduced
                      ? { duration: 0 }
                      : {
                          type: 'spring',
                          stiffness: 380,
                          damping: 32,
                          delay: Math.min(i, 8) * 0.03,
                        }
                  }
                />
              </span>
              <span aria-hidden className="w-10 shrink-0 text-right text-xs text-mute tabular-nums">
                {pct}%
              </span>
            </span>
            {/* Read once, after the amount: "32% of the total". */}
            <span className="sr-only">
              {`, ${t('insights.byCategory.share', { percent: `${pct}%` })}`}
            </span>
          </>
        )
        return (
          <li key={d.key}>
            {d.link ? (
              <Link
                {...d.link}
                className="-mx-2 block rounded-[0.75rem] px-2 py-1 transition-colors hover:bg-sunken/70"
              >
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        )
      })}
    </ol>
  )
}
