import {
  cancelEvent,
  planAvatarUrl,
  planQueries,
  plansKeys,
  scheduleEvent,
  PlanError,
  type PlanAvailabilityRequest,
  type PlanBestSlot,
  type PlanEventWithGroup,
  type PlanMember,
} from '@potluck/api'
import { can } from '@potluck/core'
import { formatDateRange, formatTime, t } from '@potluck/i18n'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  SegmentedControl,
  Skeleton,
  toast,
  useIsDesktop,
} from '@potluck/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { CalendarDays, MapPin, Receipt, Users } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { AvailabilityHeatmap, type HeatRow } from '@/features/availability/availability-heatmap'
import { AvailabilityPainter } from '@/features/availability/availability-painter'
import { buildGridModel, busySlots, slotKey, type GridModel } from '@/features/availability/grid'
import { BackToPlans } from './back-link'
import { BestTimes } from './best-times'
import { CommentsThread } from './comments-thread'
import { formatDuration, minuteOfDayIn, planErrorMessage } from './format'
import { NudgePanel } from './nudge-panel'
import { RsvpPanel } from './rsvp-panel'
import { ScheduledHero } from './scheduled-hero'
import { mySlots, useEventRealtime, useMyAvailability, type SaveState } from './use-event'
import { useViewer } from './viewer'

const avatarUrl = (path: string | null) => planAvatarUrl(supabase, path)
const STATUS_TONE = {
  polling: 'saffron',
  scheduled: 'olive',
  cancelled: 'tomato',
  done: 'neutral',
} as const

export function EventPage({ eventId }: { eventId: string }) {
  const viewer = useViewer()
  const eventQ = useQuery(planQueries.event(supabase, eventId))
  const event = eventQ.data
  const groupId = event?.group_id
  const membersQ = useQuery({ ...planQueries.members(supabase, groupId ?? ''), enabled: !!groupId })
  useEventRealtime(eventId, groupId)

  if (eventQ.isError || membersQ.isError) {
    const missing = eventQ.error instanceof PlanError && eventQ.error.code === 'event_not_found'
    const failed = eventQ.isError ? eventQ : membersQ
    return (
      <Shell>
        <EmptyState
          title={missing ? t('events.notFound.title') : t('errors.generic')}
          description={missing ? t('events.notFound.body') : undefined}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {!missing && (
                <Button variant="ink" onClick={() => void failed.refetch()}>
                  {t('common.retry')}
                </Button>
              )}
              <Button asChild variant={missing ? 'ink' : 'secondary'}>
                <Link to="/plans">{t('events.notFound.action')}</Link>
              </Button>
            </div>
          }
        />
      </Shell>
    )
  }

  if (!event || !membersQ.data) return <EventSkeleton />

  return (
    <EventBody
      event={event}
      members={membersQ.data}
      viewerId={viewer.userId}
      timeZone={viewer.timeZone}
    />
  )
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-4 pt-4 pb-28 lg:px-8 lg:pb-12">{children}</div>
}

function EventSkeleton() {
  return (
    <Shell>
      <div aria-busy className="flex flex-col gap-4">
        <Skeleton shape="circle" className="size-11" />
        <Skeleton shape="line" className="w-24" />
        <Skeleton className="h-14 w-3/4" />
        <Skeleton shape="line" className="w-1/2" />
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-[28rem]" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-44" />
            <Skeleton className="h-32" />
          </div>
        </div>
      </div>
    </Shell>
  )
}

interface BodyProps {
  event: PlanEventWithGroup
  members: PlanMember[]
  viewerId: string
  timeZone: string
}

function EventBody({ event, members, viewerId, timeZone }: BodyProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [justLocked, setJustLocked] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const me = members.find((m) => m.userId === viewerId)
  const isCreator = event.created_by === viewerId
  const canManage = can(me?.role, 'event.lock', { isCreator })
  const canCancel = can(me?.role, 'event.cancel', { isCreator })
  const organizer = members.find((m) => m.userId === event.created_by)

  const lock = useMutation({
    mutationFn: (startsAt: string) => scheduleEvent(supabase, event.id, startsAt),
    onSuccess: (row) => {
      queryClient.setQueryData<PlanEventWithGroup>(plansKeys.event(event.id), (prev) =>
        prev ? { ...prev, ...row } : prev,
      )
      setJustLocked(true)
      toast.success(t('events.locked'))
      if (typeof navigator !== 'undefined') navigator.vibrate?.(20)
      void queryClient.invalidateQueries({ queryKey: plansKeys.timelineAll() })
      void queryClient.invalidateQueries({ queryKey: plansKeys.groupEvents(event.group_id) })
    },
    onError: (error) => toast.error(planErrorMessage(error)),
  })

  const cancel = useMutation({
    mutationFn: () => cancelEvent(supabase, event.id),
    onSuccess: (row) => {
      queryClient.setQueryData<PlanEventWithGroup>(plansKeys.event(event.id), (prev) =>
        prev ? { ...prev, ...row } : prev,
      )
      toast(t('events.cancelled'))
      void queryClient.invalidateQueries({ queryKey: plansKeys.timelineAll() })
      void queryClient.invalidateQueries({ queryKey: plansKeys.groupEvents(event.group_id) })
    },
    onError: (error) => toast.error(planErrorMessage(error)),
  })

  const details = <Details event={event} organizer={organizer} timeZone={timeZone} />
  const comments = (
    <CommentsThread
      eventId={event.id}
      members={members}
      viewerId={viewerId}
      timeZone={timeZone}
      avatarUrl={avatarUrl}
    />
  )
  const cancelButton =
    canCancel && (event.status === 'polling' || event.status === 'scheduled') ? (
      <Button
        variant="ghost"
        size="sm"
        className="self-start text-tomato-ink"
        onClick={() => setCancelOpen(true)}
      >
        {t('events.cancel')}
      </Button>
    ) : null

  const expenseHref = `/new/expense?groupId=${event.group_id}&eventId=${event.id}`

  return (
    <Shell>
      <EventHeader event={event} />

      {event.status === 'polling' ? (
        <PollingBody
          key={event.id}
          event={event}
          members={members}
          viewerId={viewerId}
          timeZone={timeZone}
          canLock={canManage}
          onLock={(startsAt) => lock.mutateAsync(startsAt)}
          aside={
            <>
              {details}
              {cancelButton}
            </>
          }
          comments={comments}
        />
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="flex min-w-0 flex-col gap-6">
            {event.status === 'cancelled' && (
              <Card tone="sunken" className="flourish text-xl">
                {t('events.cancelledBanner')}
              </Card>
            )}
            {event.status === 'done' && (
              <Card tone="sunken" className="flourish text-xl">
                {t('events.doneBanner')}
              </Card>
            )}
            {event.starts_at && event.ends_at && event.status !== 'cancelled' && (
              <ScheduledHero
                calendar={{
                  id: event.id,
                  title: event.title,
                  description: event.description,
                  location: event.location,
                  startsAt: event.starts_at,
                  endsAt: event.ends_at,
                  url: typeof window !== 'undefined' ? window.location.href : undefined,
                }}
                timeZone={timeZone}
                location={event.location}
                justLocked={justLocked}
              />
            )}
            <div className="lg:hidden">{details}</div>
            {event.status === 'scheduled' && (
              <ScheduledRsvp
                event={event}
                members={members}
                viewerId={viewerId}
                timeZone={timeZone}
              />
            )}
            {event.status !== 'cancelled' && (
              <a
                href={expenseHref}
                onClick={(e) => {
                  e.preventDefault()
                  void navigate({ href: expenseHref })
                }}
                className="group flex items-center gap-3 rounded-card border border-dashed border-line-strong px-4 py-3.5 transition-colors hover:border-ink/40 hover:bg-sunken/60"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-saffron-soft text-saffron-ink">
                  <Receipt aria-hidden className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">{t('events.addExpense')}</span>
                  <span className="block text-sm text-mute">{t('events.addExpenseHint')}</span>
                </span>
              </a>
            )}
            {comments}
          </div>
          <aside className="flex flex-col gap-4">
            <div className="hidden lg:block">{details}</div>
            {cancelButton}
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        tone="danger"
        title={t('events.cancelTitle')}
        description={t('events.cancelConfirm', { event: event.title })}
        confirmLabel={t('events.cancel')}
        cancelLabel={t('common.back')}
        closeLabel={t('common.close')}
        onConfirm={() => cancel.mutateAsync()}
      />
    </Shell>
  )
}

function ScheduledRsvp({
  event,
  members,
  viewerId,
  timeZone,
}: {
  event: PlanEventWithGroup
  members: PlanMember[]
  viewerId: string
  timeZone: string
}) {
  const { data: rsvps } = useQuery(planQueries.rsvps(supabase, event.id))
  if (!rsvps) return <Skeleton className="h-48" />
  return (
    <RsvpPanel
      eventId={event.id}
      rsvps={rsvps}
      members={members}
      viewerId={viewerId}
      deadline={event.rsvp_deadline}
      timeZone={timeZone}
      avatarUrl={avatarUrl}
    />
  )
}

function EventHeader({ event }: { event: PlanEventWithGroup }) {
  return (
    <header className="flex flex-col gap-3">
      <div className="-mx-2 flex items-center justify-between">
        <BackToPlans label={t('events.back')} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {event.emoji && (
          <span aria-hidden className="text-3xl leading-none">
            {event.emoji}
          </span>
        )}
        <Badge tone={STATUS_TONE[event.status]} dot>
          {t(`events.status.${event.status}`)}
        </Badge>
        {event.group && (
          <Link
            to="/groups/$groupId"
            params={{ groupId: event.group_id }}
            className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-sm font-semibold text-mute hover:bg-sunken hover:text-ink"
          >
            <span aria-hidden>{event.group.emoji}</span>
            {event.group.name}
          </Link>
        )}
      </div>
      <h1 className="flourish text-[2.75rem] leading-[0.95] text-balance sm:text-6xl">
        {event.title}
      </h1>
    </header>
  )
}

function Details({
  event,
  organizer,
  timeZone,
}: {
  event: PlanEventWithGroup
  organizer: PlanMember | undefined
  timeZone: string
}) {
  return (
    <Card className="flex flex-col gap-3 text-sm">
      {event.description && (
        <p className="text-[0.9375rem] leading-relaxed whitespace-pre-wrap">{event.description}</p>
      )}
      <dl className="flex flex-col gap-2 text-mute">
        {event.location && (
          <div className="flex items-start gap-2">
            <dt className="sr-only">{t('events.where')}</dt>
            <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" />
            <dd className="text-ink">{event.location}</dd>
          </div>
        )}
        {event.status === 'polling' && (
          <div className="flex items-start gap-2">
            <dt className="sr-only">{t('events.when')}</dt>
            <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0" />
            <dd>
              {t('events.windowRange', {
                range: formatDateRange(event.window_start, event.window_end, { timeZone }),
                from: formatTime(
                  minuteOfDayIn(event.window_start, event.day_start_minute, event.timezone),
                  { timeZone },
                ),
                to: formatTime(
                  minuteOfDayIn(event.window_start, event.day_end_minute, event.timezone),
                  { timeZone },
                ),
              })}
              <br />
              {t('events.durationShort', { duration: formatDuration(event.duration_minutes) })}
              {', '}
              {t('events.minPeople', { count: event.min_attendees }).toLowerCase()}
            </dd>
          </div>
        )}
        {organizer && (
          <div className="flex items-start gap-2">
            <dt className="sr-only">{t('events.who')}</dt>
            <Users aria-hidden className="mt-0.5 size-4 shrink-0" />
            <dd>{t('events.organizer', { name: organizer.displayName })}</dd>
          </div>
        )}
      </dl>
      {event.timezone !== timeZone && (
        <p className="text-xs text-mute">{t('events.timezoneNote', { zone: timeZone })}</p>
      )}
    </Card>
  )
}

interface PollingProps {
  event: PlanEventWithGroup
  members: PlanMember[]
  viewerId: string
  timeZone: string
  canLock: boolean
  onLock: (startsAt: string) => Promise<unknown>
  aside: ReactNode
  comments: ReactNode
}

function PollingBody({
  event,
  members,
  viewerId,
  timeZone,
  canLock,
  onLock,
  aside,
  comments,
}: PollingProps) {
  const desktop = useIsDesktop()
  const availQ = useQuery(planQueries.availability(supabase, event.id))
  const requestsQ = useQuery(planQueries.requests(supabase, event.id))
  const bestQ = useQuery(planQueries.bestSlots(supabase, event.id))
  const range = useMemo(
    () => ({
      from: new Date(Date.parse(`${event.window_start}T00:00:00Z`) - 86_400_000).toISOString(),
      to: new Date(Date.parse(`${event.window_end}T00:00:00Z`) + 2 * 86_400_000).toISOString(),
    }),
    [event.window_start, event.window_end],
  )
  const busyQ = useQuery(planQueries.busy(supabase, viewerId, range))
  const [tab, setTab] = useState<'mine' | 'group' | null>(null)
  const [preview, setPreview] = useState<PlanBestSlot | null>(null)

  const model = useMemo(() => buildGridModel(event, timeZone), [event, timeZone])
  const busy = useMemo(
    () => busySlots(model.slots, model.slotMinutes, busyQ.data ?? []),
    [model, busyQ.data],
  )
  const rows = availQ.data
  const initial = useMemo(() => mySlots(rows ?? [], viewerId), [rows, viewerId])
  const mine = useMyAvailability(event.id, viewerId, initial)
  const heatRows = useMemo<HeatRow[]>(
    () =>
      (rows ?? []).map((r) => ({ userId: r.user_id, slot: slotKey(r.slot_start), level: r.level })),
    [rows],
  )
  const responded = useMemo(() => new Set(heatRows.map((r) => r.userId)), [heatRows])
  const highlight = useMemo(() => {
    if (!preview) return undefined
    const from = Date.parse(preview.starts_at)
    const to = Date.parse(preview.ends_at)
    return new Set(model.slots.filter((s) => Date.parse(s) >= from && Date.parse(s) < to))
  }, [preview, model])

  const iResponded = responded.has(viewerId)
  // Pick the starting tab once, when availability first loads: painting must not flip it.
  if (tab === null && rows) setTab(iResponded ? 'group' : 'mine')
  const view = tab ?? 'group'

  const best = (
    <BestTimes
      slots={bestQ.data}
      members={members}
      timeZone={timeZone}
      canLock={canLock}
      onLock={onLock}
      // Outline the slot on the heatmap only. Hovering or scrolling past a card must not
      // swap the painter out from under someone who is still adding their times.
      onPreview={setPreview}
      avatarUrl={avatarUrl}
    />
  )

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="flex min-w-0 flex-col gap-6">
        {!desktop && best}
        <Card className="flex flex-col gap-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold tracking-tight">
              {view === 'mine' ? t('availability.title') : t('availability.heatmapTitle')}
            </h2>
            <SegmentedControl<'mine' | 'group'>
              label={t('availability.heatmapTitle')}
              size="sm"
              value={view}
              onValueChange={setTab}
              options={[
                { value: 'mine', label: t('events.tabs.mine') },
                {
                  value: 'group',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="relative flex size-2">
                        <span className="absolute inset-0 animate-ping rounded-full bg-tomato opacity-60 motion-reduce:hidden" />
                        <span className="relative size-2 rounded-full bg-tomato" />
                      </span>
                      {t('events.tabs.group')}
                    </span>
                  ),
                },
              ]}
            />
          </div>
          {!rows ? (
            <Skeleton className="h-[24rem]" />
          ) : view === 'mine' ? (
            <MyPainter event={event} model={model} busy={busy} {...mine} />
          ) : (
            <AvailabilityHeatmap
              model={model}
              rows={heatRows}
              members={members}
              busy={busy}
              highlight={highlight}
              viewerId={viewerId}
              label={t('availability.heatGridLabel', { event: event.title })}
              avatarUrl={avatarUrl}
            />
          )}
          {view === 'group' && rows && !iResponded && (
            <p className="flex flex-wrap items-center justify-between gap-2 rounded-[0.875rem] bg-tomato-soft px-3.5 py-2.5 text-sm text-tomato-ink">
              {t('availability.youHaveNotResponded')}
              <Button size="sm" onClick={() => setTab('mine')}>
                {t('events.card.addTimes')}
              </Button>
            </p>
          )}
        </Card>
        <div className="lg:hidden">
          <NudgeBlock
            event={event}
            members={members}
            responded={responded}
            viewerId={viewerId}
            timeZone={timeZone}
            requests={requestsQ.data}
          />
        </div>
        <div className="flex flex-col gap-4 lg:hidden">{aside}</div>
        {comments}
      </div>
      <aside className="hidden flex-col gap-4 lg:flex">
        {desktop && best}
        <NudgeBlock
          event={event}
          members={members}
          responded={responded}
          viewerId={viewerId}
          timeZone={timeZone}
          requests={requestsQ.data}
        />
        {aside}
      </aside>
    </div>
  )
}

function NudgeBlock({
  event,
  members,
  responded,
  viewerId,
  timeZone,
  requests,
}: {
  event: PlanEventWithGroup
  members: PlanMember[]
  responded: ReadonlySet<string>
  viewerId: string
  timeZone: string
  requests: PlanAvailabilityRequest[] | undefined
}) {
  if (!requests) return <Skeleton className="h-32" />
  return (
    <NudgePanel
      eventId={event.id}
      members={members}
      responded={responded}
      requests={requests}
      viewerId={viewerId}
      timeZone={timeZone}
      avatarUrl={avatarUrl}
    />
  )
}

function MyPainter({
  event,
  model,
  busy,
  value,
  change,
  state,
  rejection,
  retry,
}: {
  event: PlanEventWithGroup
  model: GridModel
  busy: ReadonlySet<string>
} & ReturnType<typeof useMyAvailability>) {
  return (
    <div className="flex flex-col gap-2">
      <AvailabilityPainter
        model={model}
        value={value}
        onChange={change}
        busy={busy}
        label={t('availability.gridLabel', { event: event.title })}
      />
      <SaveIndicator state={state} rejection={rejection} onRetry={() => void retry()} />
    </div>
  )
}

function SaveIndicator({
  state,
  rejection,
  onRetry,
}: {
  state: SaveState
  rejection: string | null
  onRetry: () => void
}) {
  const label =
    state === 'saving'
      ? t('availability.saving')
      : state === 'saved'
        ? t('availability.savedState')
        : state === 'error'
          ? t('events.errors.saveFailed')
          : state === 'failed'
            ? t('events.errors.saveGaveUp')
            : state === 'rejected'
              ? (rejection ?? '')
              : ''
  const alarmed = state === 'error' || state === 'failed' || state === 'rejected'
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <p
        role="status"
        className={alarmed ? 'text-xs font-semibold text-tomato-ink' : 'text-xs text-mute'}
      >
        {label}
      </p>
      {state === 'failed' && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}
