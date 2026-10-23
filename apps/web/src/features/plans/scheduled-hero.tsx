import { DEFAULT_LOCALE, formatDate, formatTime, t } from '@potluck/i18n'
import { Button, Card, Stamp, StampAnimation, cn } from '@potluck/ui'
import { CalendarPlus, MapPin } from 'lucide-react'
import { downloadIcs, googleCalendarUrl, type CalendarEvent } from './calendar'

export interface ScheduledHeroProps {
  calendar: CalendarEvent
  timeZone: string
  location: string | null
  /** True right after the viewer locked it in: the date stamps down onto the strip. */
  justLocked: boolean
}

const dayParts = new Map<string, Intl.DateTimeFormat>()
function localDayKey(date: Date, timeZone: string): string {
  let f = dayParts.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    dayParts.set(timeZone, f)
  }
  return f.format(date)
}

const weekdayFmt = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  weekday: 'narrow',
  timeZone: 'UTC',
})
const dayFmt = new Intl.DateTimeFormat(DEFAULT_LOCALE, { day: 'numeric', timeZone: 'UTC' })
const stampCaption = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

/** A week of days around the chosen date, as noon-UTC dates for easy formatting. */
function weekAround(startsAt: string, timeZone: string) {
  const key = localDayKey(new Date(startsAt), timeZone)
  const center = Date.parse(`${key}T12:00:00Z`)
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(center + (i - 3) * 86_400_000)
    return { date, chosen: i === 3, key: date.toISOString().slice(0, 10) }
  })
}

/**
 * The scheduled plan: big date and time, and a week strip with the chosen day stamped onto it
 * (signature moment 5, animated right after locking in).
 */
export function ScheduledHero({ calendar, timeZone, location, justLocked }: ScheduledHeroProps) {
  const days = weekAround(calendar.startsAt, timeZone)
  const chosen = days[3]!
  const stamp = (
    <Stamp tone="tomato" caption={stampCaption.format(chosen.date)} className="bg-card">
      {formatTime(calendar.startsAt, { timeZone })}
    </Stamp>
  )

  return (
    <Card padding="roomy" className="flex flex-col gap-5 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[2rem] leading-[1.05] font-extrabold tracking-tight text-balance">
            {formatDate(calendar.startsAt, { timeZone, style: 'full' }).replace(/,? \d{4}$/, '')}
          </p>
          <p className="mt-1 tabular text-lg font-semibold">
            {formatTime(calendar.startsAt, { timeZone })} -{' '}
            {formatTime(calendar.endsAt, { timeZone })}
          </p>
          {location && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-mute">
              <MapPin aria-hidden className="size-4 shrink-0" />
              {location}
            </p>
          )}
        </div>
      </div>

      <ol aria-hidden className="relative grid grid-cols-7 border-t-2 border-ink pt-2">
        {days.map((d) => (
          <li
            key={d.key}
            className={cn(
              'relative flex flex-col items-center gap-0.5 text-center',
              d.chosen ? 'text-ink' : 'text-mute',
            )}
          >
            <span
              className={cn(
                'absolute -top-[0.8125rem] size-2.5 rounded-full border-2 border-ink',
                d.chosen ? 'bg-tomato' : 'bg-card',
              )}
            />
            <span className="mt-1 text-[0.6875rem] font-semibold">{weekdayFmt.format(d.date)}</span>
            <span className="tabular text-sm font-bold">{dayFmt.format(d.date)}</span>
          </li>
        ))}
        <li className="pointer-events-none col-start-3 col-end-6 row-start-2 flex justify-center pt-3">
          {justLocked ? (
            <StampAnimation show rotate={-5}>
              {stamp}
            </StampAnimation>
          ) : (
            <span className="inline-flex -rotate-[5deg]">{stamp}</span>
          )}
        </li>
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="ink"
          leadingIcon={<CalendarPlus aria-hidden />}
          onClick={() => downloadIcs(calendar)}
        >
          {t('events.addToCalendar')}
        </Button>
        <Button size="sm" variant="secondary" asChild>
          <a href={googleCalendarUrl(calendar)} target="_blank" rel="noreferrer">
            {t('events.googleCalendar')}
          </a>
        </Button>
      </div>
    </Card>
  )
}
