import { cn } from './cn'

export interface DateChipProps {
  date: Date
  locale?: string
  /** IANA zone to render the date in (the viewer's profile timezone). */
  timeZone?: string
  size?: 'sm' | 'md' | 'lg'
  /** Band color. Saffron for upcoming, tomato for today or urgent, ink for past. */
  tone?: 'saffron' | 'tomato' | 'ink'
  /** Show the weekday under the day number. */
  showWeekday?: boolean
  className?: string
}

const sizes = {
  sm: { box: 'w-11', band: 'h-4 text-[0.5625rem]', day: 'text-lg py-0.5', wd: 'text-[0.5625rem]' },
  md: { box: 'w-14', band: 'h-5 text-[0.6875rem]', day: 'text-2xl py-1', wd: 'text-[0.625rem]' },
  lg: { box: 'w-20', band: 'h-6 text-xs', day: 'text-4xl py-1.5', wd: 'text-xs' },
} as const

const bands = {
  saffron: 'bg-saffron text-on-saffron',
  tomato: 'bg-tomato-strong text-on-tomato',
  ink: 'bg-ink text-paper',
} as const

/** A tear-off calendar leaf: month band on top, big day number below. */
export function DateChip({
  date,
  locale,
  timeZone,
  size = 'md',
  tone = 'saffron',
  showWeekday = false,
  className,
}: DateChipProps) {
  const month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone }).format(date)
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone }).format(date)
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone }).format(date)
  const full = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone }).format(date)
  const s = sizes[size]
  return (
    <time
      dateTime={date.toISOString()}
      aria-label={full}
      className={cn(
        'inline-flex shrink-0 flex-col overflow-hidden rounded-[0.75rem] border border-line bg-card text-center text-ink',
        s.box,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'grid place-items-center leading-none font-bold tracking-wide',
          bands[tone],
          s.band,
        )}
      >
        {month.replace('.', '')}
      </span>
      <span aria-hidden className={cn('leading-none font-extrabold tabular', s.day)}>
        {day}
        {showWeekday && (
          <span className={cn('mt-0.5 block font-semibold text-mute', s.wd)}>{weekday}</span>
        )}
      </span>
    </time>
  )
}
