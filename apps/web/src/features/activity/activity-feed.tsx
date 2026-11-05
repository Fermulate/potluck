import { ACTIVITY_PAGE_SIZE, fetchActivity, moneyKeys } from '@potluck/api'
import { formatTime, t } from '@potluck/i18n'
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  cn,
  usePrefersReducedMotion,
} from '@potluck/ui'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo } from 'react'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { dayLabel, dayOf, groupByDay } from '@/features/expenses/format'
import { avatarUrl, useNameOf, usePeople, useTimeZone } from '@/features/expenses/money-data'
import { describeActivity, type ActivityView } from './describe-activity'

const toneClass: Record<ActivityView['tone'], string> = {
  neutral: 'bg-sunken',
  olive: 'bg-olive-soft',
  plum: 'bg-plum-soft',
  saffron: 'bg-saffron-soft',
  tomato: 'bg-tomato-soft',
}

function useActivityRealtime() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const channel = supabase
      .channel('activity-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity' }, () => {
        void queryClient.invalidateQueries({ queryKey: moneyKeys.activity() })
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [queryClient])
}

/** Everything that happened across the viewer's groups, newest first, grouped by day. */
export function ActivityFeed() {
  useActivityRealtime()
  const me = useUserId()
  const people = usePeople()
  const nameOf = useNameOf()
  const timeZone = useTimeZone()
  const reduced = usePrefersReducedMotion()
  const feed = useInfiniteQuery({
    queryKey: moneyKeys.activity(),
    queryFn: ({ pageParam }) => fetchActivity(supabase, { before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.length < ACTIVITY_PAGE_SIZE ? undefined : last[last.length - 1]?.created_at,
  })

  const sections = useMemo(() => {
    // The hidden 1:1 groups are an implementation detail; their creation is not news.
    const items = (feed.data?.pages.flat() ?? []).filter(
      (item) => !(item.verb === 'group.created' && item.group?.is_direct),
    )
    return groupByDay(items, (item) => dayOf(item.created_at, timeZone))
  }, [feed.data, timeZone])

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-32 lg:px-8 lg:pt-10 lg:pb-12">
      <PageHeader title={t('activity.title')} />
      {feed.isPending ? (
        <div
          aria-busy="true"
          aria-label={t('activity.loading')}
          className="mt-4 flex flex-col gap-3"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton shape="circle" className="size-10" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton shape="line" className="w-3/4" />
                <Skeleton shape="line" className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : sections.length === 0 ? (
        <EmptyState
          illustration="🕯️"
          title={t('empty.activity.title')}
          description={t('empty.activity.body')}
          action={
            <Button asChild leadingIcon={<Plus />}>
              <Link to="/new/expense">{t('empty.activity.action')}</Link>
            </Button>
          }
        />
      ) : (
        <div className="mt-4 flex flex-col gap-6">
          {sections.map((section) => (
            <section key={section.day} aria-labelledby={`activity-${section.day}`}>
              <h2
                id={`activity-${section.day}`}
                className="mb-2 px-1 text-sm font-bold tracking-tight text-mute"
              >
                {dayLabel(section.day, timeZone)}
              </h2>
              <Card padding="none" className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {section.items.map((item, i) => {
                    const view = describeActivity(item, { viewerId: me, timeZone, nameOf })
                    const actor = item.actor_id ? people.get(item.actor_id) : undefined
                    const groupName = item.group?.is_direct
                      ? t('activity.direct')
                      : (item.group?.name ?? '')
                    const body = (
                      <>
                        <span className="relative shrink-0">
                          <Avatar
                            name={actor?.display_name ?? item.actor?.display_name ?? '?'}
                            seed={item.actor_id ?? item.id}
                            src={avatarUrl(actor?.avatar_path ?? item.actor?.avatar_path)}
                            size="md"
                          />
                          <span
                            aria-hidden
                            className={cn(
                              'absolute -right-1.5 -bottom-1 grid size-6 place-items-center rounded-full text-sm leading-none ring-2 ring-card',
                              toneClass[view.tone],
                            )}
                          >
                            {view.emoji}
                          </span>
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-[0.9375rem] leading-snug text-ink">
                            {view.text}
                          </span>
                          {view.detail && (
                            <span className="line-clamp-2 text-sm text-ink/80 italic">
                              “{view.detail}”
                            </span>
                          )}
                          <span className="text-xs text-mute">
                            {groupName && (
                              <span className="font-semibold">
                                {item.group?.emoji && !item.group.is_direct
                                  ? `${item.group.emoji} `
                                  : ''}
                                {groupName}
                              </span>
                            )}
                            {groupName && ', '}
                            <time dateTime={item.created_at}>
                              {formatTime(item.created_at, { timeZone })}
                            </time>
                          </span>
                        </span>
                      </>
                    )
                    const rowClass = 'flex items-start gap-3 px-4 py-3'
                    return (
                      <motion.li
                        key={item.id}
                        initial={reduced ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i, 10) * 0.03, duration: 0.25 }}
                      >
                        {view.link ? (
                          <Link
                            {...view.link}
                            className={cn(
                              rowClass,
                              'outline-offset-[-2px] transition-colors hover:bg-sunken/70',
                            )}
                          >
                            {body}
                          </Link>
                        ) : (
                          <div className={rowClass}>{body}</div>
                        )}
                      </motion.li>
                    )
                  })}
                </ul>
              </Card>
            </section>
          ))}
          {feed.hasNextPage && (
            <Button
              variant="secondary"
              className="self-center"
              loading={feed.isFetchingNextPage}
              onClick={() => void feed.fetchNextPage()}
            >
              {t('activity.loadMore')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
