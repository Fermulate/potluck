import { planQueries } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Button, Card, Chip, EmptyState, PageHeader, Skeleton } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
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

export function PlansPage() {
  const { timeZone } = useViewer()
  const now = useNow()
  const range = useTimelineRange()
  const timeline = useQuery(planQueries.timeline(supabase, range))
  const past = useQuery(planQueries.past(supabase, range.from))
  const groups = useQuery(planQueries.groups(supabase))
  const [groupId, setGroupId] = useState<string | null>(null)

  const rows = useMemo(() => (timeline.data ?? []).map(fromTimeline), [timeline.data])
  const visible = (list: PlanRowData[]) =>
    groupId ? list.filter((r) => r.groupId === groupId) : list

  const polling = visible(rows.filter((r) => r.status === 'polling'))
  const needsTimes = polling.filter((r) => r.needsTimes)
  const waiting = polling.filter((r) => !r.needsTimes)
  const scheduled = rows.filter((r) => r.status === 'scheduled' && r.startsAt)
  const endedBy = (r: PlanRowData) => Date.parse(r.endsAt ?? r.startsAt!) < now
  const upcoming = visible(scheduled.filter((r) => !endedBy(r)))
  const days = groupByDay(upcoming, (r) => r.startsAt!, { timeZone, now })
  const ended = scheduled
    .filter(endedBy)
    .sort((a, b) => Date.parse(b.startsAt!) - Date.parse(a.startsAt!))
  const pastRows = visible([...ended, ...(past.data ?? []).map(fromEvent)])
  const todayKey = dayKey(now, timeZone)

  const loading = timeline.isPending
  const empty = !loading && rows.length === 0 && pastRows.length === 0

  const planButton = (
    <Button asChild size="sm" leadingIcon={<Plus aria-hidden />}>
      <Link to="/new/plan" search={groupId ? { groupId } : {}}>
        {t('events.new')}
      </Link>
    </Button>
  )

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-28 lg:px-8 lg:pb-12">
      <PageHeader title={t('events.title')} subtitle={t('events.subtitle')} actions={planButton} />

      {(groups.data?.length ?? 0) > 1 && (
        <div
          role="group"
          aria-label={t('events.filters.label')}
          className="-mx-4 mt-5 scrollbar-none flex gap-2 overflow-x-auto px-4 pb-1"
        >
          <Chip selected={groupId === null} onClick={() => setGroupId(null)}>
            {t('events.filters.all')}
          </Chip>
          {groups.data!.map((g) => (
            <Chip
              key={g.id}
              selected={groupId === g.id}
              onClick={() => setGroupId(groupId === g.id ? null : g.id)}
              icon={g.emoji ? <span className="text-sm leading-none">{g.emoji}</span> : undefined}
            >
              {g.name}
            </Chip>
          ))}
        </div>
      )}

      {loading ? (
        <div aria-busy className="mt-8 flex flex-col gap-4">
          <Skeleton shape="line" className="w-32" />
          <Skeleton className="h-36" />
          <Skeleton shape="line" className="w-24" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : empty ? (
        <EmptyState
          className="mt-10"
          title={t('empty.plans.title')}
          description={t('empty.plans.body')}
          illustration={<span className="text-6xl">🗓️</span>}
          action={planButton}
        />
      ) : (
        <div className="mt-8 flex flex-col gap-10">
          {needsTimes.length > 0 && (
            <Appear as="section" className="flex flex-col gap-3">
              <SectionTitle
                title={t('events.sections.polling')}
                hint={t('events.sections.pollingHint')}
                count={needsTimes.length}
              />
              <PollCards plans={needsTimes} />
            </Appear>
          )}

          <section className="flex flex-col gap-3">
            <SectionTitle title={t('events.sections.upcoming')} />
            {days.length > 0 ? (
              <DayTimeline groups={days} timeZone={timeZone} todayKey={todayKey} startIndex={1} />
            ) : (
              <p className="flourish text-xl text-mute">{t('timeline.empty.body')}</p>
            )}
          </section>

          {waiting.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionTitle title={t('events.sections.waiting')} />
              <Card padding="none" className="divide-y divide-line overflow-hidden">
                {waiting.map((plan) => (
                  <PlanRow key={plan.id} plan={plan} timeZone={timeZone} />
                ))}
              </Card>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <SectionTitle title={t('events.sections.past')} />
            {pastRows.length > 0 ? (
              <Card padding="none" className="divide-y divide-line overflow-hidden">
                {pastRows.map((plan) => (
                  <PlanRow key={plan.id} plan={plan} timeZone={timeZone} />
                ))}
              </Card>
            ) : (
              <p className="text-sm text-mute">{t('events.emptyPast')}</p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function SectionTitle({ title, hint, count }: { title: string; hint?: string; count?: number }) {
  return (
    <div className="flex flex-col gap-0.5 px-1">
      <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
        {title}
        {count !== undefined && (
          <span className="grid min-w-6 place-items-center rounded-pill bg-tomato px-1.5 tabular text-xs font-bold text-on-tomato">
            {count}
          </span>
        )}
      </h2>
      {hint && <p className="text-sm text-mute">{hint}</p>}
    </div>
  )
}
