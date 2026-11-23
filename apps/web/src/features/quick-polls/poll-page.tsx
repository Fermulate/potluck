import {
  closeQuickPoll,
  deleteQuickPoll,
  quickPollKeys,
  quickPollQueries,
  setQuickPollAvailability,
  type QuickPollView,
} from '@potluck/api'
import { cleanGuestName, QUICK_POLL_NAME_MAX } from '@potluck/core'
import { formatDate, formatTime, t } from '@potluck/i18n'
import {
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  Skeleton,
  toast,
  usePrefersReducedMotion,
} from '@potluck/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { EyeOff, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AvailabilityHeatmap } from '@/features/availability/availability-heatmap'
import { AvailabilityPainter } from '@/features/availability/availability-painter'
import { buildGridModel, slotKey, type PaintLevel } from '@/features/availability/grid'
import { SentCard } from '@/features/availability/sent-card'
import { Fact, WindowFacts } from '@/features/availability/window-facts'
import { BestTimes } from '@/features/plans/best-times'
import { DeadEnd, Notice, Pitch, PublicFrame } from '@/features/shell/public-page'
import { useSession } from '@/lib/auth'
import { errorCode, errorMessage, isNotFoundError } from '@/lib/errors'
import { detectTimezone } from '@/lib/locale'
import { newRequestId } from '@/lib/request-id'
import { supabase } from '@/lib/supabase'
import { pollMemory, type PollMemory } from './poll-memory'
import { answerName, gridEvent, pollResults } from './results'
import { SharePoll } from './share-poll'

type LivePoll = Exclude<QuickPollView, { status: 'expired' }>

/** Looking at the poll, or painting an answer. Only an open poll can be painted. */
type Mode = 'viewing' | 'editing'

/** Save errors that mean the poll stopped taking this answer: the page reloads and says why. */
const STOPPED = new Set(['quick_poll_closed', 'quick_poll_expired', 'quick_poll_full'])

/** How often results refresh while the tab is in view. Anonymous visitors have no Realtime. */
const REFRESH_MS = 15_000

/** Polls are reached by a private link; keep them out of search results (with `_headers`). */
const noIndex = <meta name="robots" content="noindex" />

/**
 * `/p/<code>`: a quick poll (ADR 22). Anyone with the link adds their times and sees everyone's.
 * The page renders from the poll's status (`open`, `full`, `closed`, `expired`) and one local
 * mode; the browser keeps its token per poll to edit its answer, and the creator's token also
 * closes or deletes the poll.
 */
export function PollPage({ code }: { code: string }) {
  const [memory, setMemory] = useState<PollMemory | null>(() => pollMemory.read(code))
  // Painted or typed but not saved: if the poll stops taking answers meanwhile, the page says so.
  const [unsaved, setUnsaved] = useState(false)
  // The first save keeps a new token, which changes the query key; keep showing the poll meanwhile.
  const preview = useQuery({
    ...quickPollQueries.preview(supabase, code, memory?.token ?? null),
    placeholderData: (previous) => previous,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: 'always',
  })

  if (preview.isPending) {
    return (
      <PublicFrame wide>
        {noIndex}
        <div aria-busy className="mt-8 flex flex-col gap-4">
          <Skeleton shape="line" className="h-10 w-3/4 max-w-md" />
          <Skeleton shape="line" className="w-1/2 max-w-xs" />
          <Skeleton className="mt-4 h-[26rem]" />
        </div>
      </PublicFrame>
    )
  }

  const gone = preview.isError && isNotFoundError(preview.error)
  const view = gone ? undefined : preview.data

  if (preview.isError && !gone && !view) {
    return (
      <PublicFrame>
        {noIndex}
        <div className="flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
          <span aria-hidden className="text-7xl">
            📡
          </span>
          <h1 className="flourish text-4xl leading-tight">
            {t('quickPolls.page.loadFailedTitle')}
          </h1>
          <p className="max-w-xs text-mute">{t('quickPolls.page.loadFailed')}</p>
          <Button loading={preview.isFetching} onClick={() => void preview.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      </PublicFrame>
    )
  }

  if (!view || view.status === 'expired') {
    return (
      <>
        {noIndex}
        <DeadEnd
          emoji={view ? '⏳' : '🔒'}
          title={view ? t('quickPolls.ended.title') : t('quickPolls.ended.notFoundTitle')}
          body={view ? t('quickPolls.ended.body') : t('quickPolls.ended.notFound')}
          notice={unsaved ? t('quickPolls.page.unsaved') : undefined}
          actions={<DeadEndActions />}
        />
      </>
    )
  }

  return (
    <>
      {noIndex}
      <Poll
        code={code}
        view={view}
        memory={memory}
        unsaved={unsaved}
        onSaved={(next) => {
          setUnsaved(false)
          setMemory(next)
        }}
        onDirty={() => setUnsaved(true)}
        onDiscarded={() => setUnsaved(false)}
      />
    </>
  )
}

/** Out of a dead end: make your own poll, or go to Potluck. */
function DeadEndActions() {
  const session = useSession()
  return (
    <div className="flex w-full max-w-xs flex-col gap-2">
      <Button asChild size="lg" block>
        <Link to="/poll">{t('quickPolls.ended.newPoll')}</Link>
      </Button>
      <Button asChild variant="ghost" block>
        {session ? (
          <Link to="/home">{t('guests.closed.home')}</Link>
        ) : (
          <Link to="/">{t('guests.closed.action')}</Link>
        )}
      </Button>
    </div>
  )
}

function Poll({
  code,
  view,
  memory,
  unsaved,
  onSaved,
  onDirty,
  onDiscarded,
}: {
  code: string
  view: LivePoll
  memory: PollMemory | null
  unsaved: boolean
  onSaved: (memory: PollMemory) => void
  onDirty: () => void
  onDiscarded: () => void
}) {
  const queryClient = useQueryClient()
  const session = useSession()
  const { poll, answers, status, isCreator } = view
  const timeZone = useMemo(() => detectTimezone(), [])
  const grid = useMemo(() => gridEvent(poll.grid), [poll.grid])
  const model = useMemo(() => buildGridModel(grid, timeZone), [grid, timeZone])
  const results = useMemo(() => pollResults(poll, answers), [poll, answers])
  const mine = answers.find((a) => a.mine)
  const title = poll.title ?? t('quickPolls.defaultTitle')

  const [mode, setMode] = useState<Mode>(mine ? 'viewing' : 'editing')
  const editing = status === 'open' && mode === 'editing'
  const [justSent, setJustSent] = useState(false)
  const sentRef = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()

  // On a phone the button sits below the grid; bring the confirmation (and its stamp) into view.
  useEffect(() => {
    if (!justSent) return
    sentRef.current?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }, [justSent, reduced])

  const ends = `${formatDate(poll.expiresAt, { timeZone, style: 'weekday' })}, ${formatTime(poll.expiresAt, { timeZone })}`
  const closes =
    status === 'closed'
      ? t('quickPolls.page.resultsUntil', { date: ends })
      : t('quickPolls.page.closes', { date: ends })
  // Right after making the poll, sharing it is the next step.
  const justMade = isCreator && status === 'open' && !mine

  return (
    <PublicFrame wide>
      <div className="mt-5 flex flex-col gap-5 lg:mt-12 lg:grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start lg:gap-12">
        {/* On a phone the header leads and the footer closes the page; on a desktop both sit
            in the left column beside the grid. */}
        <div className="contents lg:sticky lg:top-8 lg:flex lg:flex-col lg:gap-8">
          <header className="flex flex-col gap-3 lg:gap-5">
            <h1 className="font-display text-[2.25rem] leading-[0.95] text-balance sm:text-5xl lg:text-[3.25rem]">
              {title}
            </h1>
            <WindowFacts grid={grid} durationMinutes={poll.durationMinutes} timeZone={timeZone}>
              <Fact icon={<Users />} label={t('quickPolls.create.maxLabel')}>
                {t('quickPolls.page.answered', { count: answers.length, max: poll.maxPeople })}
              </Fact>
              {!poll.namesRequired && (
                <Fact icon={<EyeOff />} label={t('quickPolls.create.namesLabel')}>
                  {t('quickPolls.page.anonymousNote')}
                </Fact>
              )}
            </WindowFacts>
            <p className="text-sm text-mute">
              {closes} {t('quickPolls.page.timezoneNote', { zone: timeZone })}
            </p>
            {!justMade && <SharePoll code={code} title={title} />}
          </header>
          <footer className="order-last flex flex-col gap-5 lg:order-none">
            {isCreator && (
              <CreatorControls code={code} token={memory?.token ?? ''} status={status} />
            )}
            {!session && (
              <Pitch
                title={t('quickPolls.page.pitchTitle')}
                body={t('quickPolls.page.pitchBody')}
                className="flex"
              />
            )}
          </footer>
        </div>

        <section className="flex min-w-0 flex-col gap-5" aria-label={title}>
          {justMade && <SharePoll code={code} title={title} prominent />}

          {status === 'full' && (
            <StatusCard
              title={t('quickPolls.page.fullTitle')}
              body={t('quickPolls.page.fullBody', { max: poll.maxPeople })}
              unsaved={unsaved}
            />
          )}
          {status === 'closed' && (
            <StatusCard
              title={t('quickPolls.page.closedTitle')}
              body={isCreator ? t('quickPolls.page.closedByYou') : t('quickPolls.page.closedBody')}
              unsaved={unsaved}
            />
          )}

          {status === 'open' && mine && !editing && (
            <div ref={sentRef} className="scroll-mt-4">
              <SentCard
                stamp={justSent}
                stampLabel={t('quickPolls.page.sentStamp')}
                title={
                  poll.namesRequired
                    ? t('quickPolls.page.sentTitle', { name: answerName(mine) })
                    : t('quickPolls.page.sentTitleAnon', { name: answerName(mine) })
                }
                body={t('quickPolls.page.sentBody')}
                actionLabel={t('quickPolls.page.edit')}
                onAction={() => {
                  setMode('editing')
                  setJustSent(false)
                }}
              />
            </div>
          )}

          {editing && (
            <AnswerForm
              code={code}
              view={view}
              model={model}
              title={title}
              memory={memory}
              onCancel={
                mine
                  ? () => {
                      setMode('viewing')
                      onDiscarded()
                    }
                  : undefined
              }
              onSaved={(next) => {
                onSaved(next)
                setMode('viewing')
                setJustSent(true)
              }}
              onDirty={onDirty}
              onStopped={() => {
                void queryClient.invalidateQueries({ queryKey: quickPollKeys.preview(code) })
              }}
            />
          )}

          {answers.length === 0 ? (
            <Card tone="ghost" padding="roomy" className="flex flex-col gap-2">
              <p className="flourish text-2xl leading-tight">
                {t('quickPolls.page.noAnswersTitle')}
              </p>
              <p className="text-sm text-mute">{t('quickPolls.page.noAnswersBody')}</p>
            </Card>
          ) : (
            <>
              <BestTimes
                slots={results.best}
                members={results.people}
                timeZone={timeZone}
                canLock={false}
                onLock={async () => undefined}
                nameOf={(person) => person?.displayName ?? ''}
              />
              <Card className="flex flex-col gap-4 sm:p-6">
                <h2 className="text-xl font-bold tracking-tight">
                  {t('quickPolls.page.everyoneTitle')}
                </h2>
                <AvailabilityHeatmap
                  model={model}
                  rows={results.rows}
                  members={results.people}
                  viewerId={results.mineId}
                  label={t('quickPolls.page.heatGridLabel', { title })}
                  nameOf={(person) => person?.displayName ?? ''}
                />
              </Card>
            </>
          )}
        </section>
      </div>
    </PublicFrame>
  )
}

/** Why the poll takes no answers, said above the results that stay readable. */
function StatusCard({ title, body, unsaved }: { title: string; body: string; unsaved: boolean }) {
  return (
    <Card tone="sunken" padding="roomy" className="flex flex-col gap-2">
      <h2 className="flourish text-2xl leading-tight">{title}</h2>
      {unsaved && <Notice>{t('quickPolls.page.unsaved')}</Notice>}
      <p className="text-sm text-mute">{body}</p>
    </Card>
  )
}

/** Paint your times (and give a name when the poll asks for one), then send them. */
function AnswerForm({
  code,
  view,
  model,
  title,
  memory,
  onCancel,
  onSaved,
  onDirty,
  onStopped,
}: {
  code: string
  view: LivePoll
  model: ReturnType<typeof buildGridModel>
  title: string
  memory: PollMemory | null
  onCancel?: () => void
  onSaved: (memory: PollMemory) => void
  onDirty: () => void
  onStopped: () => void
}) {
  const queryClient = useQueryClient()
  const { poll, answers } = view
  const mine = answers.find((a) => a.mine)
  const saved = useMemo(
    () =>
      new Map<string, PaintLevel>((mine?.slots ?? []).map((s) => [slotKey(s.slot_start), s.level])),
    [mine],
  )
  const [value, setValue] = useState<Map<string, PaintLevel>>(saved)
  const [name, setName] = useState(mine?.name ?? memory?.name ?? '')
  const [nameError, setNameError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  // The token a new visitor made for their first save, for when storage is blocked.
  const madeToken = useRef<string | null>(null)
  const cleanName = cleanGuestName(name)

  const save = useMutation({
    mutationFn: (token: string) =>
      setQuickPollAvailability(supabase, {
        code,
        name: poll.namesRequired ? cleanName : null,
        token,
        slots: [...value].map(([slot_start, level]) => ({ slot_start, level })),
      }),
    onSuccess: async (_, token) => {
      const next = { token, name: poll.namesRequired ? cleanName : '' }
      pollMemory.write(code, next)
      // Load the poll with the answer in it before leaving the form, so "Sent" has it to show.
      try {
        await queryClient.fetchQuery({
          ...quickPollQueries.preview(supabase, code, next.token),
          staleTime: 0,
        })
      } catch {
        // Saved all the same; the next refresh shows it.
      }
      onSaved(next)
    },
    onError: (error) => {
      const reason = errorCode(error)
      if (isNotFoundError(error) || (reason && STOPPED.has(reason))) onStopped()
      setFormError(errorMessage(error, 'quickPolls.errors'))
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (poll.namesRequired) {
      if (!cleanName) {
        setNameError(t('quickPolls.page.needName'))
        nameRef.current?.focus()
        return
      }
      if ([...cleanName].length > QUICK_POLL_NAME_MAX) {
        setNameError(t('quickPolls.errors.invalid_quick_poll_name'))
        nameRef.current?.focus()
        return
      }
    }
    if (!mine && value.size === 0) {
      setFormError(t('quickPolls.page.needTimes'))
      return
    }
    // A new visitor makes their token and keeps it before the first save goes out, so a retry
    // after a lost reply (or a reload) sends the same one and edits that answer, not a second.
    let token = memory?.token ?? madeToken.current
    if (!token) {
      token = newRequestId()
      madeToken.current = token
      pollMemory.write(code, { token, name: poll.namesRequired ? cleanName : '' })
    }
    save.mutate(token)
  }

  return (
    <form noValidate onSubmit={submit} className="contents">
      <Card className="flex flex-col gap-4 sm:p-6">
        <h2 className="text-xl font-bold tracking-tight">{t('quickPolls.page.paintTitle')}</h2>
        <AvailabilityPainter
          model={model}
          value={value}
          onChange={(next) => {
            setValue(next)
            setFormError(null)
            onDirty()
          }}
          label={t('quickPolls.page.gridLabel', { title })}
        />
        {poll.namesRequired && (
          <Field
            label={t('quickPolls.page.nameLabel')}
            hint={t('quickPolls.page.nameHint')}
            error={nameError ?? undefined}
          >
            <Input
              ref={nameRef}
              value={name}
              maxLength={QUICK_POLL_NAME_MAX}
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
      <div className="sticky bottom-0 z-20 -mx-4 flex flex-col gap-2 border-t border-line bg-paper/92 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.875rem)] backdrop-blur sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        {formError && (
          <p role="alert" className="text-sm font-semibold text-tomato-ink">
            {formError}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 lg:flex-row lg:justify-end">
          {onCancel && (
            <Button type="button" variant="ghost" size="lg" onClick={onCancel}>
              {t('quickPolls.page.cancel')}
            </Button>
          )}
          <Button type="submit" size="lg" loading={save.isPending} className="w-full lg:w-auto">
            {mine ? t('quickPolls.page.update') : t('quickPolls.page.submit')}
          </Button>
        </div>
      </div>
    </form>
  )
}

/** Close and delete, for whoever made the poll. Both ask first. */
function CreatorControls({
  code,
  token,
  status,
}: {
  code: string
  token: string
  status: LivePoll['status']
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [asking, setAsking] = useState<'close' | 'delete' | null>(null)

  const close = async () => {
    try {
      await closeQuickPoll(supabase, { code, creatorToken: token })
    } catch (error) {
      toast.error(errorMessage(error, 'quickPolls.errors'))
      throw error
    }
    toast.success(t('quickPolls.page.closed'))
    await queryClient.invalidateQueries({ queryKey: quickPollKeys.preview(code) })
  }

  const remove = async () => {
    try {
      await deleteQuickPoll(supabase, { code, creatorToken: token })
    } catch (error) {
      toast.error(errorMessage(error, 'quickPolls.errors'))
      throw error
    }
    pollMemory.forget(code)
    toast.success(t('quickPolls.page.deleted'))
    await navigate({ to: '/poll' })
    queryClient.removeQueries({ queryKey: quickPollKeys.preview(code) })
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-card p-4">
      <h2 className="font-semibold">{t('quickPolls.page.yourPoll')}</h2>
      <div className="flex flex-wrap gap-2">
        {status !== 'closed' && (
          <Button size="sm" variant="secondary" onClick={() => setAsking('close')}>
            {t('quickPolls.page.close')}
          </Button>
        )}
        <Button size="sm" variant="danger" onClick={() => setAsking('delete')}>
          {t('quickPolls.page.delete')}
        </Button>
      </div>
      <ConfirmDialog
        open={asking === 'close'}
        onOpenChange={(open) => !open && setAsking(null)}
        title={t('quickPolls.page.closeTitle')}
        description={t('quickPolls.page.closeConfirm')}
        confirmLabel={t('quickPolls.page.close')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        onConfirm={close}
      />
      <ConfirmDialog
        open={asking === 'delete'}
        onOpenChange={(open) => !open && setAsking(null)}
        title={t('quickPolls.page.deleteTitle')}
        description={t('quickPolls.page.deleteConfirm')}
        confirmLabel={t('quickPolls.page.delete')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        tone="danger"
        onConfirm={remove}
      />
    </div>
  )
}
