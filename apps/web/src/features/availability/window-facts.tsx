import { formatDateRange, formatTime, t } from '@potluck/i18n'
import { CalendarDays, Clock } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatDuration, minuteOfDayIn } from '@/features/plans/format'
import type { GridEvent } from './grid'

/** One line of `WindowFacts`: an icon, a label for screen readers and the value. */
export function Fact({
  icon,
  label,
  children,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5">
      <dt className="sr-only">{label}</dt>
      <span
        aria-hidden
        className="mt-0.5 shrink-0 text-mute [&_svg]:size-4 lg:[&_svg]:size-[1.125rem]"
      >
        {icon}
      </span>
      <dd>{children}</dd>
    </div>
  )
}

/**
 * What a poll asks about, in the viewer's zone: the days and hours, then how long the plan
 * lasts. `children` adds more `Fact` lines.
 */
export function WindowFacts({
  grid,
  durationMinutes,
  timeZone,
  children,
}: {
  grid: Pick<
    GridEvent,
    'window_start' | 'window_end' | 'day_start_minute' | 'day_end_minute' | 'timezone'
  >
  durationMinutes: number
  timeZone: string
  children?: ReactNode
}) {
  const at = (minute: number) =>
    formatTime(minuteOfDayIn(grid.window_start, minute, grid.timezone), { timeZone })
  return (
    <dl className="flex flex-col gap-1.5 text-sm lg:gap-2 lg:text-[0.9375rem]">
      <Fact icon={<CalendarDays />} label={t('events.when')}>
        {t('events.windowRange', {
          range: formatDateRange(grid.window_start, grid.window_end, { timeZone }),
          from: at(grid.day_start_minute),
          to: at(grid.day_end_minute),
        })}
      </Fact>
      <Fact icon={<Clock />} label={t('events.create.durationLabel')}>
        {t('events.durationShort', { duration: formatDuration(durationMinutes) })}
      </Fact>
      {children}
    </dl>
  )
}
