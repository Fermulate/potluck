import { formatDateRange, formatTime, t } from '@potluck/i18n'
import { Badge, DateChip, ListRow } from '@potluck/ui'
import { Link } from '@tanstack/react-router'
import { MapPin } from 'lucide-react'
import type { PlanRowData } from './plan-row-data'

export interface PlanRowProps {
  plan: PlanRowData
  timeZone: string
  /** `YYYY-MM-DD` today in the viewer's zone, to color today's chip. */
  todayKey?: string
  dayKeyOf?: (iso: string) => string
  showGroup?: boolean
}

/** One plan in a list: tear-off date chip, title, when and where, and what it needs from you. */
export function PlanRow({ plan, timeZone, todayKey, dayKeyOf, showGroup = true }: PlanRowProps) {
  const scheduled = !!plan.startsAt && plan.status !== 'polling'
  const date = scheduled ? new Date(plan.startsAt!) : new Date(`${plan.windowStart}T12:00:00Z`)
  const isToday = scheduled && todayKey && dayKeyOf ? dayKeyOf(plan.startsAt!) === todayKey : false
  const past = plan.status === 'done' || plan.status === 'cancelled'
  const tone = past || !scheduled ? 'ink' : isToday ? 'tomato' : 'saffron'

  const subtitle = scheduled ? (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1">
      <span className="tabular">
        {formatTime(plan.startsAt!, { timeZone })}
        {plan.location ? ',' : ''}
      </span>
      {plan.location && (
        <>
          <MapPin aria-hidden className="ml-0.5 size-3.5 shrink-0" />
          <span className="truncate">{plan.location}</span>
        </>
      )}
    </span>
  ) : (
    t('events.card.pollWindow', {
      range: formatDateRange(plan.windowStart, plan.windowEnd, { timeZone: 'UTC' }),
    })
  )

  let meta = null
  if (plan.status === 'cancelled')
    meta = <Badge tone="tomato">{t('events.status.cancelled')}</Badge>
  else if (plan.needsTimes)
    meta = (
      <Badge tone="tomato" dot>
        {t('timeline.needsAvailability')}
      </Badge>
    )
  else if (plan.needsRsvp)
    meta = (
      <Badge tone="saffron" dot>
        {t('timeline.needsRsvp')}
      </Badge>
    )
  else if (!scheduled) meta = <Badge tone="neutral">{t('timeline.polling')}</Badge>
  else if (plan.goingCount !== undefined)
    meta = (
      <span className="tabular text-sm font-semibold text-mute">
        {t('events.card.going', { count: plan.goingCount })}
      </span>
    )

  return (
    <ListRow
      asChild
      leading={
        <DateChip date={date} timeZone={scheduled ? timeZone : 'UTC'} tone={tone} size="sm" />
      }
      title={
        <>
          {plan.emoji && (
            <span aria-hidden className="mr-1.5">
              {plan.emoji}
            </span>
          )}
          {plan.title}
        </>
      }
      subtitle={subtitle}
      meta={meta}
      metaSub={
        showGroup && plan.groupName ? (
          // Capped so a long group name never squeezes the plan's own title.
          <span className="flex max-w-[7rem] items-center gap-1 sm:max-w-[12rem]">
            {plan.groupEmoji && (
              <span aria-hidden className="shrink-0">
                {plan.groupEmoji}
              </span>
            )}
            <span className="truncate">{plan.groupName}</span>
          </span>
        ) : undefined
      }
      className={past ? 'opacity-75' : undefined}
    >
      <Link to="/plans/$eventId" params={{ eventId: plan.id }} />
    </ListRow>
  )
}
