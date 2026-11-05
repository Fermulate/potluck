import { planQueries, plansKeys } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Button, Card, EmptyState, Skeleton } from '@potluck/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { Appear } from '@/features/timeline/appear'
import { DayTimeline } from '@/features/timeline/day-timeline'
import { dayKey, groupByDay } from '@/features/timeline/days'
import { PlanRow } from '@/features/timeline/plan-row'
import { fromEvent, fromTimeline, type PlanRowData } from '@/features/timeline/plan-row-data'
import { PollCards } from './poll-cards'
import { useNow } from './use-now'
import { useTimelineRange } from './use-range'
import { useViewer } from './viewer'

/** Keeps a group's event list fresh while the tab is open. */
function useGroupEventsRealtime(groupId: string) {
  const queryClient = useQueryClient()
  useEffect(() => {
    const channel = supabase
      .channel(`group-plans:${groupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'events', filter: `group_id=eq.${groupId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: plansKeys.groupEvents(groupId) })
          void queryClient.invalidateQueries({ queryKey: plansKeys.timelineAll() })
        },
      )
      .subscribe()
    return () => void supabase.removeChannel(channel)
  }, [groupId, queryClient])
}

/** The Plans tab inside a group: open polls, the group's calendar, and past plans. */
export function GroupPlansPage({ groupId }: { groupId: string }) {
  const { timeZone } = useViewer()
  const now = useNow()
  const range = useTimelineRange()
  const events = useQuery(planQueries.groupEvents(supabase, groupId))
  const timeline = useQuery(planQueries.timeline(supabase, range))
  useGroupEventsRealtime(groupId)

  const mine = useMemo(
    () => new Map((timeline.data ?? []).map((item) => [item.event_id, fromTimeline(item)])),
    [timeline.data],
  )
  const rows: PlanRowData[] = useMemo(
    () => (events.data ?? []).map((e) => mine.get(e.id) ?? fromEvent(e)),
    [events.data, mine],
  )

  const polls = rows.filter((r) => r.status === 'polling')
  const needsTimes = polls.filter((r) => r.needsTimes)
  const otherPolls = polls.filter((r) => !r.needsTimes)
  const upcoming = rows
    .filter((r) => r.status === 'scheduled' && r.endsAt && Date.parse(r.endsAt) >= now)
    .sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!))
  const past = rows
    .filter(
      (r) =>
        r.status === 'done' ||
        r.status === 'cancelled' ||
        (r.status === 'scheduled' && r.endsAt && Date.parse(r.endsAt) < now),
    )
    .sort(
      (a, b) => Date.parse(b.startsAt ?? b.windowStart) - Date.parse(a.startsAt ?? a.windowStart),
    )
    .slice(0, 10)
  const days = groupByDay(upcoming, (r) => r.startsAt!, { timeZone, now })
  const todayKey = dayKey(now, timeZone)

  const planButton = (
    <Button asChild size="sm" leadingIcon={<Plus aria-hidden />}>
      <Link to="/new/plan" search={{ groupId }}>
        {t('events.new')}
      </Link>
    </Button>
  )

  if (events.isPending) {
    return (
      <div aria-busy className="flex flex-col gap-4 py-6">
        <Skeleton shape="line" className="w-32" />
        <Skeleton className="h-36" />
        <Skeleton className="h-20" />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        className="py-12"
        title={t('events.emptyGroup.title')}
        description={t('events.emptyGroup.body')}
        illustration={<span className="text-6xl">🗓️</span>}
        action={planButton}
      />
    )
  }

  return (
    <div className="flex flex-col gap-10 py-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold tracking-tight">{t('events.title')}</h2>
        {planButton}
      </div>

      {polls.length > 0 && (
        <Appear as="section" className="flex flex-col gap-3">
          <h3 className="px-1 text-lg font-bold">{t('events.sections.groupPolls')}</h3>
          {needsTimes.length > 0 && <PollCards plans={needsTimes} />}
          {otherPolls.length > 0 && (
            <Card padding="none" className="divide-y divide-line overflow-hidden">
              {otherPolls.map((plan) => (
                <PlanRow key={plan.id} plan={plan} timeZone={timeZone} showGroup={false} />
              ))}
            </Card>
          )}
        </Appear>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="px-1 text-lg font-bold">{t('events.sections.groupTimeline')}</h3>
        {days.length > 0 ? (
          <DayTimeline
            groups={days}
            timeZone={timeZone}
            todayKey={todayKey}
            showGroup={false}
            startIndex={1}
          />
        ) : (
          <p className="flourish text-xl text-mute">{t('timeline.empty.body')}</p>
        )}
      </section>

      {past.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="px-1 text-lg font-bold">{t('events.sections.past')}</h3>
          <Card padding="none" className="divide-y divide-line overflow-hidden">
            {past.map((plan) => (
              <PlanRow key={plan.id} plan={plan} timeZone={timeZone} showGroup={false} />
            ))}
          </Card>
        </section>
      )}
    </div>
  )
}
