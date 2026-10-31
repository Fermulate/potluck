import { profilesByIdsQueryOptions, type NotificationRow } from '@potluck/api'
import { formatRelative, t } from '@potluck/i18n'
import { Button, cn, EmptyState, PageHeader, Skeleton, usePrefersReducedMotion } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRightLeft,
  Bell,
  CalendarHeart,
  CheckCheck,
  MessageCircle,
  Receipt,
  UserPlus,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, type ReactNode } from 'react'
import { groupTitle } from '@/features/expenses/format'
import { useMyGroups } from '@/features/groups/use-groups'
import { useUserId } from '@/lib/auth'
import { useViewerTimezone } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { describeNotification, type NotificationKind, type NotificationView } from './describe'
import { useMarkRead, useNotifications } from './use-notifications'

const kindStyle: Record<NotificationKind, { icon: ReactNode; tile: string }> = {
  money: { icon: <Receipt />, tile: 'bg-tomato-soft text-tomato-ink' },
  payment: { icon: <ArrowRightLeft />, tile: 'bg-olive-soft text-olive-ink' },
  people: { icon: <UserPlus />, tile: 'bg-plum-soft text-plum-ink' },
  plan: { icon: <CalendarHeart />, tile: 'bg-saffron-soft text-saffron-ink' },
  comment: { icon: <MessageCircle />, tile: 'bg-sunken text-ink' },
  other: { icon: <Bell />, tile: 'bg-sunken text-ink' },
}

function Row({
  row,
  view,
  timeZone,
  onOpen,
}: {
  row: NotificationRow
  view: NotificationView
  timeZone: string
  onOpen: () => void
}) {
  const reduced = usePrefersReducedMotion()
  const unread = !row.read_at
  const style = kindStyle[view.kind]
  return (
    <motion.li
      layout={!reduced}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 380, damping: 32 }}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'relative flex w-full items-start gap-3 rounded-card p-3 text-left transition-colors duration-150',
          unread ? 'bg-card ring-1 ring-line hover:ring-ink/25' : 'hover:bg-sunken',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-[0.75rem] [&_svg]:size-5',
            style.tile,
          )}
        >
          {style.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block text-[0.9375rem]', unread ? 'font-bold' : 'font-semibold')}>
            {view.title}
          </span>
          <span className="mt-0.5 block text-sm text-mute">{view.body}</span>
          <span className="mt-1 block tabular text-xs text-mute">
            {formatRelative(row.created_at, { timeZone })}
          </span>
        </span>
        {unread && (
          <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-tomato">
            <span className="sr-only">{t('notifications.unreadLabel')}</span>
          </span>
        )}
      </button>
    </motion.li>
  )
}

export function NotificationsPage() {
  const navigate = useNavigate()
  const viewerId = useUserId()
  const timeZone = useViewerTimezone()
  const { data: rows, isPending } = useNotifications()
  const { data: groups } = useMyGroups()
  const markRead = useMarkRead()

  const actorIds = useMemo(
    () =>
      (rows ?? [])
        .flatMap((r) => {
          const d = r.data as Record<string, unknown> | null
          return [d?.actor_id, d?.from_user, d?.to_user]
        })
        .filter((id): id is string => typeof id === 'string'),
    [rows],
  )
  const { data: people } = useQuery({
    ...profilesByIdsQueryOptions(supabase, actorIds),
    enabled: actorIds.length > 0,
  })

  const ctx = useMemo(
    () => ({
      people: new Map((people ?? []).map((p) => [p.id, p.display_name])),
      groups: new Map((groups ?? []).map((g) => [g.id, groupTitle(g, viewerId)])),
      timeZone,
    }),
    [people, groups, viewerId, timeZone],
  )

  const unread = (rows ?? []).filter((r) => !r.read_at)
  const earlier = (rows ?? []).filter((r) => r.read_at)

  function open(row: NotificationRow, view: NotificationView) {
    if (!row.read_at) markRead.mutate([row.id])
    void navigate(view.target)
  }

  const list = (items: NotificationRow[]) => (
    <ul className="grid gap-1.5">
      <AnimatePresence initial={false}>
        {items.map((row) => {
          const view = describeNotification(row, ctx)
          return (
            <Row
              key={row.id}
              row={row}
              view={view}
              timeZone={timeZone}
              onOpen={() => open(row, view)}
            />
          )
        })}
      </AnimatePresence>
    </ul>
  )

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-6 pb-32 lg:px-8 lg:pt-10 lg:pb-12">
      <PageHeader title={t('notifications.title')} />
      <div className="mt-3 flex min-h-9 flex-wrap items-center justify-between gap-3">
        {/* Nothing until the list is in: "All caught up" over a loading list is a fib. */}
        {isPending ? (
          <Skeleton shape="line" className="w-28" />
        ) : (
          <p className="text-[0.9375rem] text-mute">
            {unread.length > 0
              ? t('notifications.unread', { count: unread.length })
              : t('notifications.allCaughtUp')}
          </p>
        )}
        {unread.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<CheckCheck />}
            onClick={() => markRead.mutate('all')}
          >
            {t('notifications.markAllRead')}
          </Button>
        )}
      </div>
      <div className="mt-6 grid gap-8">
        {isPending ? (
          <div className="grid gap-2" aria-hidden>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex gap-3 p-3">
                <Skeleton className="size-10 rounded-[0.75rem]" />
                <div className="grid flex-1 gap-2">
                  <Skeleton shape="line" className="w-1/2" />
                  <Skeleton shape="line" className="w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : (rows ?? []).length === 0 ? (
          <EmptyState
            illustration="🛎️"
            title={t('empty.notifications.title')}
            description={t('empty.notifications.body')}
            action={
              <Button asChild variant="secondary">
                <Link to="/home">{t('empty.notifications.action')}</Link>
              </Button>
            }
          />
        ) : (
          <>
            {unread.length > 0 && (
              <section aria-label={t('notifications.new')} className="grid gap-2">
                <h2 className="text-sm font-bold text-mute">{t('notifications.new')}</h2>
                {list(unread)}
              </section>
            )}
            {earlier.length > 0 && (
              <section aria-label={t('notifications.earlier')} className="grid gap-2">
                <h2 className="text-sm font-bold text-mute">{t('notifications.earlier')}</h2>
                {list(earlier)}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
