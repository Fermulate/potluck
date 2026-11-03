import { planQueries, type PlanGroup, type PlanTimelineItem } from '@potluck/api'
import { formatDate, formatTime, greeting, t } from '@potluck/i18n'
import { Badge, Button, Card, cn, EmptyState, Skeleton } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CalendarHeart, ChevronRight, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { firstName } from '@/features/plans/format'
import { useNow } from '@/features/plans/use-now'
import { useTimelineRange } from '@/features/plans/use-range'
import { useRsvp } from '@/features/plans/use-rsvp'
import { useViewer } from '@/features/plans/viewer'
import { Appear } from '@/features/timeline/appear'
import { dayKey } from '@/features/timeline/days'
import { PlanRow } from '@/features/timeline/plan-row'
import { fromTimeline } from '@/features/timeline/plan-row-data'
import { BalanceHero } from './balance-hero'
import { summarizeBalances } from './summary'

const UPCOMING_DAYS = 14
const HOLD_MS = 1500

export function HomeDashboard() {
  const viewer = useViewer()
  const now = useNow()
  const range = useTimelineRange()
  const balances = useQuery(planQueries.homeBalances(supabase, viewer.userId))
  const timeline = useQuery(planQueries.timeline(supabase, range))
  const groups = useQuery(planQueries.groups(supabase))

  const items = useMemo(() => timeline.data ?? [], [timeline.data])
  const needsTimes = items.filter((i) => i.status === 'polling' && !i.availability_submitted)
  // Asked explicitly first.
  needsTimes.sort((a, b) => Number(b.availability_requested) - Number(a.availability_requested))
  const needsRsvp = items.filter(
    (i) => i.status === 'scheduled' && !i.my_rsvp && i.starts_at && Date.parse(i.starts_at) > now,
  )
  const upcoming = items.filter(
    (i) =>
      i.status === 'scheduled' &&
      i.starts_at &&
      Date.parse(i.ends_at ?? i.starts_at) >= now &&
      Date.parse(i.starts_at) < now + UPCOMING_DAYS * 86_400_000,
  )
  const waiting = needsTimes.length + needsRsvp.length
  // A lone card fills the row; several peek in from the edge so you know to swipe.
  const cardWidth = waiting === 1 ? 'w-full shrink-0' : 'w-64 shrink-0 snap-start'

  // The session carries the name from sign up, so the greeting (the largest text on the
  // screen) can paint before the profile request returns. The profile wins once it is in.
  const session = useSession()
  const metaName = session?.user.user_metadata?.display_name
  const displayName =
    viewer.profile?.displayName ?? (typeof metaName === 'string' ? metaName : undefined)
  const name = firstName(displayName ?? '')
  const summary = balances.data
    ? summarizeBalances(balances.data, viewer.profile?.defaultCurrency)
    : null
  const todayKey = dayKey(now, viewer.timeZone)
  // On phones everything stacks, so "Needs you" (known once the timeline is in) and the real
  // balance card (taller than its skeleton) would push down whatever was already on screen.
  // What sits below them waits, invisible but laid out, until both have answered (with data or
  // an error) or a moment has passed, whichever comes first.
  const [heldLongEnough, setHeldLongEnough] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setHeldLongEnough(true), HOLD_MS)
    return () => clearTimeout(timer)
  }, [])
  const settled = heldLongEnough || (!timeline.isPending && !balances.isPending)
  const holdBelow = settled ? undefined : 'max-lg:invisible'

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 lg:px-8 lg:pb-12">
      <header className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {displayName ? (
            <h1 className="flourish text-[2.25rem] leading-none text-ink sm:text-5xl">
              {greeting(name, { timeZone: viewer.timeZone, now })}
            </h1>
          ) : (
            <Skeleton shape="line" className="h-9 w-56" />
          )}
          <p className="mt-2 text-sm text-mute">
            {timeline.isPending
              ? ' '
              : waiting > 0
                ? t('home.summary.some', { count: waiting })
                : t('home.summary.none')}
          </p>
        </div>
      </header>

      <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          <Appear index={0}>
            {summary ? (
              <BalanceHero summary={summary} />
            ) : (
              <Skeleton className="h-[19rem] rounded-b-none" aria-busy />
            )}
          </Appear>

          {(needsTimes.length > 0 || needsRsvp.length > 0) && (
            <Appear
              as="section"
              index={1}
              className={cn('-mx-4 flex flex-col gap-3 lg:mx-0', holdBelow)}
            >
              <div className="flex items-baseline justify-between px-4 lg:px-0">
                <h2 className="text-xl font-bold tracking-tight">{t('home.needsYou')}</h2>
                <Badge tone="tomato">{t('home.needsYouCount', { count: waiting })}</Badge>
              </div>
              <ul className="scrollbar-none flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 lg:flex-wrap lg:px-0">
                {needsTimes.map((item) => (
                  <li key={item.event_id} className={cardWidth}>
                    <TimesCard item={item} />
                  </li>
                ))}
                {needsRsvp.map((item) => (
                  <li key={item.event_id} className={cardWidth}>
                    <RsvpCard item={item} viewerId={viewer.userId} timeZone={viewer.timeZone} />
                  </li>
                ))}
              </ul>
            </Appear>
          )}
        </div>

        <div className={cn('flex min-w-0 flex-col gap-8', holdBelow)}>
          <Appear as="section" index={2} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-bold tracking-tight">{t('timeline.title')}</h2>
              <Link
                to="/plans"
                className="inline-flex items-center gap-0.5 text-sm font-semibold text-mute hover:text-ink"
              >
                {t('common.seeAll')}
                <ChevronRight aria-hidden className="size-4" />
              </Link>
            </div>
            {timeline.isPending ? (
              <div aria-busy className="flex flex-col gap-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : upcoming.length === 0 ? (
              <Card tone="ghost" padding="roomy">
                <EmptyState
                  as="h3"
                  align="start"
                  title={t('timeline.empty.title')}
                  description={t('timeline.empty.body')}
                  action={
                    <Button asChild size="sm" leadingIcon={<CalendarHeart aria-hidden />}>
                      <Link to="/new/plan">{t('timeline.empty.action')}</Link>
                    </Button>
                  }
                />
              </Card>
            ) : (
              <Card padding="none" className="divide-y divide-line overflow-hidden">
                {upcoming.map((item) => (
                  <PlanRow
                    key={item.event_id}
                    plan={fromTimeline(item)}
                    timeZone={viewer.timeZone}
                    todayKey={todayKey}
                    dayKeyOf={(iso) => dayKey(iso, viewer.timeZone)}
                  />
                ))}
              </Card>
            )}
          </Appear>

          <Appear as="section" index={3} className="flex flex-col gap-3">
            <h2 className="text-xl font-bold tracking-tight">{t('home.groups')}</h2>
            {groups.isPending ? (
              <div className="flex gap-3">
                <Skeleton className="h-28 w-36" />
                <Skeleton className="h-28 w-36" />
                <Skeleton className="h-28 w-36" />
              </div>
            ) : (
              <GroupsRow groups={groups.data ?? []} />
            )}
          </Appear>
        </div>
      </div>
    </div>
  )
}

function TimesCard({ item }: { item: PlanTimelineItem }) {
  return (
    <Card className="flex h-full flex-col gap-3">
      <p className="flex items-center gap-2 text-xs font-semibold text-mute">
        <span aria-hidden className="text-base leading-none">
          {item.group_emoji}
        </span>
        {item.group_name}
      </p>
      <p className="flex items-start gap-2">
        {item.emoji && (
          <span aria-hidden className="text-xl leading-none">
            {item.emoji}
          </span>
        )}
        <span className="text-[1.0625rem] leading-snug font-semibold text-balance">
          {item.title}
        </span>
      </p>
      <div className="mt-auto flex items-center justify-between gap-2">
        <Badge tone="saffron" dot>
          {t('timeline.polling')}
        </Badge>
        <Button asChild size="sm">
          <Link to="/plans/$eventId" params={{ eventId: item.event_id }}>
            {t('home.needsTimes')}
          </Link>
        </Button>
      </div>
    </Card>
  )
}

function RsvpCard({
  item,
  viewerId,
  timeZone,
}: {
  item: PlanTimelineItem
  viewerId: string
  timeZone: string
}) {
  const rsvp = useRsvp(item.event_id, viewerId)
  return (
    <Card className="flex h-full flex-col gap-3">
      <p className="flex items-center gap-2 text-xs font-semibold text-mute">
        <span aria-hidden className="text-base leading-none">
          {item.group_emoji}
        </span>
        {item.group_name}
      </p>
      <Link
        to="/plans/$eventId"
        params={{ eventId: item.event_id }}
        className="flex flex-col gap-0.5 rounded-[0.5rem] hover:underline"
      >
        <span className="text-[1.0625rem] leading-snug font-semibold text-balance">
          {item.emoji && (
            <span aria-hidden className="mr-1.5">
              {item.emoji}
            </span>
          )}
          {item.title}
        </span>
        <span className="tabular text-sm text-mute">
          {formatDate(item.starts_at!, { timeZone, style: 'weekday' })},{' '}
          {formatTime(item.starts_at!, { timeZone })}
        </span>
      </Link>
      <div className="mt-auto flex gap-1.5" role="group" aria-label={t('home.needsRsvp')}>
        <Button
          size="sm"
          variant="secondary"
          className="flex-1"
          disabled={rsvp.isPending}
          onClick={() => rsvp.mutate('declined')}
        >
          {t('rsvp.short.declined')}
        </Button>
        <Button
          size="sm"
          className="flex-1"
          disabled={rsvp.isPending}
          onClick={() => rsvp.mutate('going')}
        >
          {t('rsvp.short.going')}
        </Button>
      </div>
    </Card>
  )
}

function GroupsRow({ groups }: { groups: PlanGroup[] }) {
  return (
    <ul className="-mx-4 scrollbar-none flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-3 lg:px-0">
      {groups.map((g) => (
        <li key={g.id} className="w-36 shrink-0 snap-start lg:w-auto">
          <Link
            to="/groups/$groupId"
            params={{ groupId: g.id }}
            className="flex h-full flex-col gap-3 rounded-card border border-line bg-card p-4 transition-colors hover:border-ink/30"
          >
            <span
              aria-hidden
              className="grid size-11 place-items-center rounded-[0.875rem] bg-sunken text-2xl"
            >
              {g.emoji ?? g.name.slice(0, 1)}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{g.name}</span>
              <span className="block text-xs text-mute">
                {t('home.members', { count: g.memberCount })}
              </span>
            </span>
          </Link>
        </li>
      ))}
      <li className="w-36 shrink-0 snap-start lg:w-auto">
        <Link
          to="/groups"
          className="flex h-full min-h-[7.5rem] flex-col items-start justify-between gap-3 rounded-card border border-dashed border-line-strong p-4 text-mute transition-colors hover:border-ink/40 hover:text-ink"
        >
          <Plus aria-hidden className="size-6" />
          <span className="font-semibold">{t('home.newGroup')}</span>
        </Link>
      </li>
    </ul>
  )
}
