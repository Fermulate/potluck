import { guestKeys, guestQueries, setGuestAvailability, type GuestLinkPreview } from '@potluck/api'
import { cleanGuestName } from '@potluck/core'
import { formatDate, formatDateRange, formatTime, t } from '@potluck/i18n'
import {
  Button,
  Card,
  cn,
  Field,
  Input,
  SegmentedControl,
  Skeleton,
  Stamp,
  StampAnimation,
  usePrefersReducedMotion,
} from '@potluck/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CalendarDays, Clock } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AvailabilityPainter } from '@/features/availability/availability-painter'
import { buildGridModel, slotKey, type PaintLevel } from '@/features/availability/grid'
import { Help } from '@/features/help/help'
import {
  formatDuration,
  minuteOfDayIn,
  planErrorCode,
  planErrorMessage,
} from '@/features/plans/format'
import { Wordmark } from '@/features/shell/brand'
import { useSession } from '@/lib/auth'
import { isNotFoundError } from '@/lib/errors'
import { detectTimezone } from '@/lib/locale'
import { supabase } from '@/lib/supabase'
import { GuestHeatmap } from './guest-heatmap'
import { readGuestMemory, writeGuestMemory, type GuestMemory } from './guest-token'

type OpenPreview = GuestLinkPreview & { plan: NonNullable<GuestLinkPreview['plan']> }
type Scheduled = NonNullable<GuestLinkPreview['scheduled']>

/** Codes that mean the link stopped taking this answer: show why, not just a toast. */
const CLOSING_CODES = new Set([
  'guest_link_revoked',
  'guest_link_expired',
  'guest_link_not_found',
  'guest_removed',
  'event_not_polling',
  'group_archived',
])

/** The longest name the server keeps, counted in characters like Postgres does. */
const MAX_NAME = 40

function Frame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[50dvh] bg-[radial-gradient(ellipse_at_30%_0%,color-mix(in_oklab,var(--pl-saffron)_32%,transparent),transparent_65%)]"
      />
      <main
        id="main"
        className={
          wide
            ? 'relative mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pt-4 pb-10 sm:px-6 lg:px-8 lg:pt-5'
            : 'relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-5 pb-10'
        }
      >
        <Link
          to="/"
          className={wide ? 'self-start rounded-pill' : 'self-center rounded-pill'}
          aria-label={t('app.name')}
        >
          <Wordmark />
        </Link>
        {children}
      </main>
    </div>
  )
}

/** Where someone with no account goes next: sign up, or a look at what Potluck is. */
function NextSteps() {
  const session = useSession()
  if (session) {
    return (
      <Button asChild variant="secondary">
        <Link to="/home">{t('guests.closed.home')}</Link>
      </Button>
    )
  }
  return (
    <div className="flex w-full max-w-xs flex-col gap-2">
      <Button asChild size="lg" block>
        <Link to="/sign-up">{t('guests.closed.signUp')}</Link>
      </Button>
      <Button asChild variant="ghost" block>
        <Link to="/">{t('guests.closed.action')}</Link>
      </Button>
    </div>
  )
}

/** A dead end with a way out: the link closed, is unknown, is full, or the answer was removed. */
function DeadEnd({
  emoji,
  title,
  body,
  unsaved,
}: {
  emoji: string
  title: string
  body: string
  unsaved: boolean
}) {
  return (
    <Frame>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
        <span aria-hidden className="text-7xl">
          {emoji}
        </span>
        <h1 className="flourish text-4xl leading-tight">{title}</h1>
        {unsaved && (
          <p
            role="alert"
            className="rounded-[0.875rem] bg-tomato-soft px-3.5 py-2.5 text-sm font-semibold text-tomato-ink"
          >
            {t('guests.closed.unsaved')}
          </p>
        )}
        <p className="max-w-xs text-pretty text-mute">{body}</p>
        <NextSteps />
      </div>
    </Frame>
  )
}

function closedBody(status: GuestLinkPreview['status'] | 'not_found'): string {
  switch (status) {
    case 'expired':
      return t('guests.closed.expired')
    case 'revoked':
      return t('guests.closed.revoked')
    case 'archived':
      return t('guests.closed.archived')
    case 'closed':
      return t('guests.closed.closed')
    default:
      return t('guests.closed.notFound')
  }
}

/**
 * `/a/<code>`: someone without an account adds their times to one plan. They see the plan's
 * window and, once they answer, how many people are free when; never names, balances or anything
 * else about the group. The browser keeps the token the server returns so it can edit later.
 */
export function GuestPage({ code }: { code: string }) {
  const [memory, setMemory] = useState<GuestMemory | null>(() => readGuestMemory(code))
  // Painted or typed but not saved: if the link closes meanwhile, the closed page says so.
  const [unsaved, setUnsaved] = useState(false)
  // Saving hands back a token, which changes the query key; keep showing the plan meanwhile.
  const preview = useQuery({
    ...guestQueries.preview(supabase, code, memory?.token ?? null),
    placeholderData: (previous) => previous,
  })

  if (preview.isPending) {
    return (
      <Frame wide>
        <div aria-busy className="mt-8 flex flex-col gap-4">
          <Skeleton className="size-12 rounded-[1rem] lg:size-16" />
          <Skeleton shape="line" className="h-10 w-3/4 max-w-md" />
          <Skeleton shape="line" className="w-1/2 max-w-xs" />
          <Skeleton className="mt-4 h-[26rem]" />
        </div>
      </Frame>
    )
  }

  if (preview.isError && !isNotFoundError(preview.error)) {
    return (
      <Frame>
        <div className="flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
          <span aria-hidden className="text-7xl">
            📡
          </span>
          <h1 className="flourish text-4xl leading-tight">{t('guests.page.loadFailedTitle')}</h1>
          <p className="max-w-xs text-mute">{t('guests.page.loadFailed')}</p>
          <Button loading={preview.isFetching} onClick={() => void preview.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      </Frame>
    )
  }

  const data = preview.data
  if (data?.status === 'scheduled' && data.scheduled) {
    return <ScheduledPlan plan={data.scheduled} unsaved={unsaved} />
  }
  if (data?.status === 'removed') {
    return (
      <DeadEnd
        emoji="🚪"
        title={t('guests.closed.removedTitle')}
        body={t('guests.closed.removed')}
        unsaved={unsaved}
      />
    )
  }
  if (data?.status === 'full' && data.plan) {
    const host = data.plan.hostName
    return (
      <DeadEnd
        emoji="🪑"
        title={t('guests.closed.fullTitle')}
        body={host ? t('guests.closed.full', { name: host }) : t('guests.closed.fullAnon')}
        unsaved={unsaved}
      />
    )
  }
  if (!data || data.status !== 'open' || !data.plan) {
    return (
      <DeadEnd
        emoji="🔒"
        title={t('guests.closed.title')}
        body={closedBody(data?.status ?? 'not_found')}
        unsaved={unsaved}
      />
    )
  }

  return (
    <GuestPoll
      code={code}
      preview={data as OpenPreview}
      memory={memory}
      onSaved={(next) => {
        setUnsaved(false)
        setMemory(next)
      }}
      onDirty={() => setUnsaved(true)}
    />
  )
}

/** The plan has a time: say when, in the guest's own zone. */
function ScheduledPlan({ plan, unsaved }: { plan: Scheduled; unsaved: boolean }) {
  const timeZone = useMemo(() => detectTimezone(), [])
  return (
    <Frame>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
        <PlanTile emoji={plan.emoji} groupEmoji={plan.groupEmoji} />
        <p className="flourish text-xl text-mute">
          {plan.hostName
            ? t('guests.scheduled.kicker', { name: plan.hostName })
            : t('guests.scheduled.kickerAnon')}
        </p>
        <h1 className="font-display text-5xl leading-[0.95] text-balance">{plan.title}</h1>
        <div className="flex flex-col gap-1">
          <p className="text-2xl font-extrabold tracking-tight text-balance">
            {formatDate(plan.startsAt, { timeZone, style: 'full' })}
          </p>
          <p className="tabular text-lg font-semibold">
            {formatTime(plan.startsAt, { timeZone })} - {formatTime(plan.endsAt, { timeZone })}
          </p>
          <p className="text-sm text-mute">{t('guests.page.timezoneNote', { zone: timeZone })}</p>
        </div>
        {unsaved && (
          <p
            role="alert"
            className="rounded-[0.875rem] bg-tomato-soft px-3.5 py-2.5 text-sm font-semibold text-tomato-ink"
          >
            {t('guests.closed.unsaved')}
          </p>
        )}
        <p className="max-w-xs text-pretty">
          {t('guests.scheduled.thanks', { name: plan.myName })}
        </p>
        <NextSteps />
      </div>
    </Frame>
  )
}

function PlanTile({
  emoji,
  groupEmoji,
  className,
}: {
  emoji: string | null
  groupEmoji: string | null
  className?: string
}) {
  return (
    <div className={cn('relative size-14 shrink-0 lg:size-[4.5rem]', className)}>
      <span
        aria-hidden
        className="grid size-full -rotate-3 place-items-center rounded-[1rem] border border-line bg-card text-[2rem] shadow-raised lg:rounded-[1.25rem] lg:text-[2.75rem]"
      >
        {emoji ?? '🗓️'}
      </span>
      {groupEmoji && (
        <span
          aria-hidden
          className="absolute -right-2 -bottom-2 grid size-7 place-items-center rounded-full border-2 border-paper bg-saffron-soft text-sm lg:size-8 lg:text-base"
        >
          {groupEmoji}
        </span>
      )}
    </div>
  )
}

function GuestPoll({
  code,
  preview,
  memory,
  onSaved,
  onDirty,
}: {
  code: string
  preview: OpenPreview
  memory: GuestMemory | null
  onSaved: (memory: GuestMemory) => void
  onDirty: () => void
}) {
  const queryClient = useQueryClient()
  const plan = preview.plan
  const timeZone = useMemo(() => detectTimezone(), [])
  const model = useMemo(() => buildGridModel(plan, timeZone), [plan, timeZone])
  const saved = useMemo(
    () =>
      new Map<string, PaintLevel>(
        (preview.mine?.slots ?? []).map((s) => [slotKey(s.slot_start), s.level]),
      ),
    [preview.mine],
  )
  const answered = !!preview.mine
  const [name, setName] = useState(preview.mine?.name ?? memory?.name ?? '')
  const [value, setValue] = useState<Map<string, PaintLevel>>(saved)
  const [editing, setEditing] = useState(!answered)
  const [view, setView] = useState<'mine' | 'everyone'>('mine')
  const [nameError, setNameError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [justSent, setJustSent] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const reduced = usePrefersReducedMotion()
  const cleanName = cleanGuestName(name)

  // On a phone the button sits below the grid; bring the confirmation (and its stamp) into view.
  useEffect(() => {
    if (!justSent) return
    sectionRef.current?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }, [justSent, reduced])

  const save = useMutation({
    mutationFn: () =>
      setGuestAvailability(supabase, {
        code,
        name: cleanName,
        token: memory?.token ?? null,
        slots: [...value].map(([slot_start, level]) => ({ slot_start, level })),
      }),
    onSuccess: (result) => {
      const next = { token: result.token, name: cleanName }
      writeGuestMemory(code, next)
      setName(cleanName)
      setJustSent(true)
      setEditing(false)
      setView('everyone')
      onSaved(next)
      void queryClient.invalidateQueries({ queryKey: guestKeys.preview(code) })
    },
    onError: (error) => {
      const reason = planErrorCode(error)
      if (reason && CLOSING_CODES.has(reason)) {
        // The page turns into the closed state and says these times did not go in.
        onDirty()
        void queryClient.invalidateQueries({ queryKey: guestKeys.preview(code) })
      }
      setFormError(planErrorMessage(error))
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!cleanName) {
      setNameError(t('guests.page.needName'))
      nameRef.current?.focus()
      return
    }
    if ([...cleanName].length > MAX_NAME) {
      setNameError(t('events.errors.invalid_guest_name'))
      nameRef.current?.focus()
      return
    }
    if (!answered && value.size === 0) {
      setFormError(t('guests.page.needTimes'))
      return
    }
    save.mutate()
  }

  const host = plan.hostName
  const closes = t('guests.page.closes', {
    date: `${formatDate(plan.expiresAt, { timeZone, style: 'weekday' })}, ${formatTime(plan.expiresAt, { timeZone })}`,
  })
  const zoneNote = t('guests.page.timezoneNote', { zone: timeZone })
  const respondents = preview.respondents ?? 0

  return (
    <Frame wide>
      <div className="mt-5 grid gap-5 lg:mt-12 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start lg:gap-12">
        <header className="flex flex-col gap-3 lg:sticky lg:top-8 lg:gap-5">
          <div className="flex items-center gap-4 lg:flex-col lg:items-start lg:gap-5">
            <PlanTile emoji={plan.emoji} groupEmoji={plan.groupEmoji} />
            <p className="flourish text-lg leading-snug text-mute lg:text-xl">
              {host ? t('guests.page.invitedBy', { name: host }) : t('guests.page.invited')}
            </p>
          </div>
          <h1 className="font-display text-[2.25rem] leading-[0.95] text-balance sm:text-5xl lg:text-[3.25rem]">
            {plan.title}
          </h1>
          <dl className="flex flex-col gap-1.5 text-sm lg:gap-2 lg:text-[0.9375rem]">
            <div className="flex items-start gap-2.5">
              <dt className="sr-only">{t('events.when')}</dt>
              <CalendarDays
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-mute lg:size-[1.125rem]"
              />
              <dd>
                {t('events.windowRange', {
                  range: formatDateRange(plan.window_start, plan.window_end, { timeZone }),
                  from: formatTime(
                    minuteOfDayIn(plan.window_start, plan.day_start_minute, plan.timezone),
                    { timeZone },
                  ),
                  to: formatTime(
                    minuteOfDayIn(plan.window_start, plan.day_end_minute, plan.timezone),
                    { timeZone },
                  ),
                })}
              </dd>
            </div>
            <div className="flex items-start gap-2.5">
              <dt className="sr-only">{t('events.create.durationLabel')}</dt>
              <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-mute lg:size-[1.125rem]" />
              <dd>
                {t('events.durationShort', { duration: formatDuration(plan.duration_minutes) })}
              </dd>
            </div>
          </dl>
          <p className="hidden text-sm text-mute lg:block">
            {closes} {zoneNote}
          </p>
          <Pitch className="hidden lg:flex" />
        </header>

        <section
          ref={sectionRef}
          className="flex min-w-0 scroll-mt-4 flex-col gap-5"
          aria-labelledby="guest-poll-title"
        >
          {!editing ? (
            <Sent
              name={cleanName}
              stamp={justSent}
              onEdit={() => {
                setEditing(true)
                setView('mine')
                setJustSent(false)
              }}
            />
          ) : null}

          <form noValidate onSubmit={submit} className="contents">
            <Card className="flex flex-col gap-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="guest-poll-title" className="text-xl font-bold tracking-tight">
                  {view === 'mine' ? t('guests.page.paintTitle') : t('guests.page.everyoneTitle')}
                </h2>
                <SegmentedControl<'mine' | 'everyone'>
                  label={t('guests.page.paintTitle')}
                  size="sm"
                  value={view}
                  onValueChange={setView}
                  options={[
                    { value: 'mine', label: t('guests.page.tabs.mine') },
                    { value: 'everyone', label: t('guests.page.tabs.everyone') },
                  ]}
                />
              </div>

              {view === 'mine' ? (
                <div
                  className={editing ? undefined : 'pointer-events-none opacity-60'}
                  inert={!editing}
                >
                  <AvailabilityPainter
                    model={model}
                    value={value}
                    onChange={(next) => {
                      setValue(next)
                      setFormError(null)
                      onDirty()
                    }}
                    label={t('guests.page.gridLabel', { event: plan.title })}
                  />
                </div>
              ) : (
                <>
                  <p className="text-sm text-mute">
                    {t('guests.page.respondents', { count: respondents })}{' '}
                    {t('guests.page.privacy')}
                  </p>
                  <GuestHeatmap
                    model={model}
                    heat={preview.heat ?? []}
                    total={Math.max(respondents, 1)}
                    mine={saved}
                    label={t('guests.page.heatGridLabel', { event: plan.title })}
                  />
                </>
              )}

              {view === 'mine' && editing && (
                <Field
                  label={t('guests.page.nameLabel')}
                  hint={t('guests.page.nameHint')}
                  error={nameError ?? undefined}
                >
                  <Input
                    ref={nameRef}
                    value={name}
                    maxLength={MAX_NAME}
                    autoComplete="given-name"
                    enterKeyHint="done"
                    onChange={(e) => {
                      setName(e.target.value)
                      setNameError(null)
                      onDirty()
                    }}
                  />
                </Field>
              )}
            </Card>

            {editing && (
              <div className="sticky bottom-0 z-20 -mx-4 flex flex-col gap-2 border-t border-line bg-paper/92 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.875rem)] backdrop-blur sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
                {formError && (
                  <p role="alert" className="text-sm font-semibold text-tomato-ink">
                    {formError}
                  </p>
                )}
                <Button
                  type="submit"
                  size="lg"
                  loading={save.isPending}
                  className="w-full lg:w-auto lg:self-end"
                >
                  {answered ? t('guests.page.update') : t('guests.page.submit')}
                </Button>
              </div>
            )}
          </form>

          <p className="text-sm text-mute lg:hidden">
            {closes} {zoneNote}
          </p>
          <Pitch className="flex lg:hidden" />
        </section>
      </div>
    </Frame>
  )
}

function Sent({ name, stamp, onEdit }: { name: string; stamp: boolean; onEdit: () => void }) {
  return (
    <Card tone="sunken" padding="roomy" className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="shrink-0 self-start sm:self-center">
        {stamp ? (
          <StampAnimation show rotate={-8}>
            <Stamp tone="olive">{t('guests.page.sentStamp')}</Stamp>
          </StampAnimation>
        ) : (
          <span className="inline-flex -rotate-[8deg]">
            <Stamp tone="olive">{t('guests.page.sentStamp')}</Stamp>
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p role="status" className="flourish text-2xl leading-tight">
          {t('guests.page.sentTitle', { name })}
        </p>
        <p className="text-sm text-mute">{t('guests.page.sentBody')}</p>
      </div>
      <Button variant="secondary" className="self-start sm:self-center" onClick={onEdit}>
        {t('guests.page.edit')}
      </Button>
    </Card>
  )
}

function Pitch({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex-col gap-2 rounded-card border border-dashed border-line-strong p-4',
        className,
      )}
    >
      <p className="font-semibold">{t('guests.page.pitchTitle')}</p>
      <p className="text-sm text-mute">{t('guests.page.pitchBody')}</p>
      <div className="flex items-center justify-between gap-2">
        <Button asChild size="sm" variant="ghost" className="-ml-2 self-start">
          <Link to="/sign-up">{t('guests.page.pitchAction')}</Link>
        </Button>
        <Help topic="guestLinks" />
      </div>
    </div>
  )
}
