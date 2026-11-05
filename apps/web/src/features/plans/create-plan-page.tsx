import {
  createPlanEvent,
  planAvatarUrl,
  planQueries,
  plansKeys,
  requestAvailability,
  type PlanMember,
} from '@potluck/api'
import { eventCreateSchema, SLOT_SIZES } from '@potluck/core'
import { hasMessage, t } from '@potluck/i18n'
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  Chip,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  TextArea,
  toast,
} from '@potluck/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { fromZonedTime } from 'date-fns-tz'
import { Minus, Plus } from 'lucide-react'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { dayKey } from '@/features/timeline/days'
import { BackToPlans } from './back-link'
import { formatDuration, formatMinuteOfDay, planErrorMessage } from './format'
import { useViewer } from './viewer'

const EMOJIS = ['🍽️', '🍕', '🌮', '🍜', '🥾', '🎲', '🎬', '🏖️', '🎉', '☕']
const DURATIONS = [30, 60, 90, 120, 180, 240, 360, 480, 720]
const DAY = 86_400_000

const addDays = (key: string, n: number) =>
  new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)

type FormField =
  | 'group_id'
  | 'title'
  | 'window_start'
  | 'window_end'
  | 'day_end_minute'
  | 'duration_minutes'
  | 'min_attendees'
  | 'rsvp_deadline'
  | 'form'

function issueText(code: string): string {
  const key = `errors.validation.${code}`
  if (hasMessage(key)) return (t as (k: string) => string)(key)
  return t('errors.validation.required')
}

export interface CreatePlanPageProps {
  groupId?: string
}

export function CreatePlanPage({ groupId: initialGroup }: CreatePlanPageProps) {
  const viewer = useViewer()
  const groups = useQuery(planQueries.groups(supabase))
  const [groupId, setGroupId] = useState<string | undefined>(initialGroup)
  const effectiveGroup = groupId ?? groups.data?.[0]?.id

  if (groups.isPending) {
    return (
      <Page>
        <div aria-busy className="flex flex-col gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-64" />
        </div>
      </Page>
    )
  }

  if (!groups.data?.length || !effectiveGroup) {
    return (
      <Page>
        <EmptyState
          title={t('empty.groups.title')}
          description={t('events.create.noGroups')}
          action={
            <Button asChild variant="ink">
              <Link to="/groups">{t('empty.groups.action')}</Link>
            </Button>
          }
        />
      </Page>
    )
  }

  return (
    <Page>
      <PlanForm
        key={viewer.timeZone}
        groups={groups.data.map((g) => ({ id: g.id, name: g.name, emoji: g.emoji }))}
        groupId={effectiveGroup}
        onGroupChange={setGroupId}
        timeZone={viewer.timeZone}
        viewerId={viewer.userId}
      />
    </Page>
  )
}

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-4 pb-28 lg:px-8 lg:pb-12">
      <PageHeader
        size="compact"
        leading={<BackToPlans label={t('events.back')} />}
        title={<span className="flourish">{t('events.create.title')}</span>}
        subtitle={t('events.create.subtitle')}
      />
      <div className="mt-6">{children}</div>
    </div>
  )
}

interface PlanFormProps {
  groups: { id: string; name: string; emoji: string | null }[]
  groupId: string
  onGroupChange: (id: string) => void
  timeZone: string
  viewerId: string
}

export function PlanForm({ groups, groupId, onGroupChange, timeZone, viewerId }: PlanFormProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [today] = useState(() => dayKey(Date.now(), timeZone))
  const members = useQuery(planQueries.members(supabase, groupId))

  const [title, setTitle] = useState('')
  const [emoji, setEmoji] = useState(EMOJIS[0]!)
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [windowStart, setWindowStart] = useState(() => addDays(today, 1))
  const [windowEnd, setWindowEnd] = useState(() => addDays(today, 7))
  const [dayStart, setDayStart] = useState(600)
  const [dayEnd, setDayEnd] = useState(1320)
  const [slot, setSlot] = useState<'15' | '30' | '60'>('30')
  const [duration, setDuration] = useState(120)
  const [minAttendees, setMinAttendees] = useState(2)
  const [deadline, setDeadline] = useState('')
  // Members to ask, per group; undefined means "everyone" (the default).
  const [picked, setPicked] = useState<Record<string, Set<string>>>({})
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({})
  const [submitting, setSubmitting] = useState(false)

  const others = useMemo(
    () => (members.data ?? []).filter((m) => m.userId !== viewerId && !m.deleted),
    [members.data, viewerId],
  )
  const selected = picked[groupId] ?? new Set(others.map((m) => m.userId))
  const setSelected = (next: Set<string>) => setPicked((p) => ({ ...p, [groupId]: next }))

  const windowDays = Math.round((Date.parse(windowEnd) - Date.parse(windowStart)) / DAY) + 1 || 0

  const hourOptions = Array.from({ length: 49 }, (_, i) => i * 30).map((m) => ({
    value: String(m),
    label: formatMinuteOfDay(m),
  }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const parsed = eventCreateSchema.safeParse({
      group_id: groupId,
      title,
      emoji,
      location,
      description,
      window_start: windowStart,
      window_end: windowEnd,
      day_start_minute: dayStart,
      day_end_minute: dayEnd,
      slot_minutes: Number(slot),
      duration_minutes: duration,
      min_attendees: minAttendees,
      rsvp_deadline: deadline ? fromZonedTime(deadline, timeZone).toISOString() : null,
    })
    if (!parsed.success) {
      const next: Partial<Record<FormField, string>> = {}
      for (const issue of parsed.error.issues) {
        const field = (issue.path[0] as FormField | undefined) ?? 'form'
        if (next[field]) continue
        const code = issue.code === 'custom' ? issue.message : 'required'
        next[field] = issueText(field === 'title' && issue.code === 'too_big' ? 'tooLong' : code)
      }
      setErrors(next)
      const first = Object.keys(next)[0]
      document.getElementById(`plan-${first}`)?.focus()
      return
    }
    setErrors({})
    setSubmitting(true)
    try {
      const event = await createPlanEvent(supabase, { ...parsed.data, timezone: timeZone })
      const ids = [...selected].filter((id) => others.some((m) => m.userId === id))
      if (ids.length > 0) {
        try {
          await requestAvailability(supabase, event.id, ids)
        } catch (error) {
          toast.error(planErrorMessage(error))
        }
      }
      void queryClient.invalidateQueries({ queryKey: plansKeys.timelineAll() })
      void queryClient.invalidateQueries({ queryKey: plansKeys.groupEvents(groupId) })
      toast.success(t('events.create.created'))
      await navigate({ to: '/plans/$eventId', params: { eventId: event.id } })
    } catch (error) {
      setErrors({ form: planErrorMessage(error) })
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <Section title={t('events.create.sectionWhat')}>
        {groups.length > 1 && (
          <Field label={t('events.create.groupLabel')} error={errors.group_id}>
            <Select
              value={groupId}
              onValueChange={onGroupChange}
              placeholder={t('events.create.groupPlaceholder')}
              options={groups.map((g) => ({
                value: g.id,
                label: g.name,
                icon: g.emoji ? <span>{g.emoji}</span> : undefined,
              }))}
            />
          </Field>
        )}
        <Field label={t('events.create.titleLabel')} error={errors.title} id="plan-title">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('events.create.titlePlaceholder')}
            maxLength={120}
            autoFocus
          />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">{t('events.create.emojiLabel')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {EMOJIS.map((e) => (
              <Chip
                key={e}
                selected={emoji === e}
                onClick={() => setEmoji(e)}
                className="size-11 justify-center px-0 text-xl"
                aria-label={e}
              >
                {e}
              </Chip>
            ))}
            <Input
              aria-label={t('events.create.emojiCustom')}
              placeholder={t('events.create.emojiCustom')}
              value={EMOJIS.includes(emoji) ? '' : emoji}
              onChange={(e) => setEmoji([...e.target.value].slice(-2).join('') || EMOJIS[0]!)}
              className="h-11 w-28"
            />
          </div>
        </fieldset>
        <Field label={t('events.create.locationLabel')} hint={t('common.optional')}>
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={t('events.create.locationPlaceholder')}
            maxLength={200}
          />
        </Field>
        <Field label={t('events.create.descriptionLabel')} hint={t('common.optional')}>
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('events.create.descriptionPlaceholder')}
            rows={3}
            maxLength={2000}
          />
        </Field>
      </Section>

      <Section
        title={t('events.create.sectionWhen')}
        aside={
          <span className="text-xs text-mute">
            {t('events.create.timezoneNote', { zone: timeZone })}
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t('events.create.windowFrom')}
            error={errors.window_start}
            id="plan-window_start"
          >
            <Input
              type="date"
              value={windowStart}
              min={today}
              onChange={(e) => {
                setWindowStart(e.target.value)
                if (e.target.value > windowEnd) setWindowEnd(e.target.value)
              }}
            />
          </Field>
          <Field label={t('events.create.windowTo')} error={errors.window_end} id="plan-window_end">
            <Input
              type="date"
              value={windowEnd}
              min={windowStart}
              onChange={(e) => setWindowEnd(e.target.value)}
            />
          </Field>
        </div>
        {windowDays > 0 && (
          <p className="-mt-2 text-sm text-mute">
            {t('events.create.windowDays', { count: windowDays })}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('events.create.hoursFrom')}>
            <Select
              value={String(dayStart)}
              onValueChange={(v) => setDayStart(Number(v))}
              options={hourOptions.slice(0, -1)}
            />
          </Field>
          <Field
            label={t('events.create.hoursTo')}
            error={errors.day_end_minute}
            id="plan-day_end_minute"
          >
            <Select
              value={String(dayEnd)}
              onValueChange={(v) => setDayEnd(Number(v))}
              options={hourOptions.slice(1)}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('events.create.durationLabel')}
            error={errors.duration_minutes}
            id="plan-duration_minutes"
          >
            <Select
              value={String(duration)}
              onValueChange={(v) => setDuration(Number(v))}
              options={DURATIONS.map((d) => ({ value: String(d), label: formatDuration(d) }))}
            />
          </Field>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">{t('events.create.slotLabel')}</span>
            <SegmentedControl<'15' | '30' | '60'>
              label={t('events.create.slotLabel')}
              block
              value={slot}
              onValueChange={setSlot}
              options={SLOT_SIZES.map((s) => ({
                value: String(s) as '15' | '30' | '60',
                label: t('events.create.slotOption', { count: s }),
              }))}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('events.create.minAttendeesLabel')}
            hint={t('events.create.minAttendeesHint')}
            error={errors.min_attendees}
          >
            <div className="flex h-12 items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="size-11 px-0"
                aria-label={t('events.create.fewer')}
                onClick={() => setMinAttendees((n) => Math.max(1, n - 1))}
              >
                <Minus aria-hidden className="size-4" />
              </Button>
              <output
                aria-live="polite"
                className="w-10 text-center tabular text-xl font-extrabold"
              >
                {minAttendees}
              </output>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="size-11 px-0"
                aria-label={t('events.create.more')}
                onClick={() => setMinAttendees((n) => Math.min(1000, n + 1))}
              >
                <Plus aria-hidden className="size-4" />
              </Button>
            </div>
          </Field>
          <Field
            label={t('events.create.deadlineLabel')}
            hint={t('events.create.deadlineHint')}
            error={errors.rsvp_deadline}
          >
            <Input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section
        title={t('events.create.sectionWho')}
        aside={
          others.length > 0 && (
            <span className="tabular text-xs font-semibold text-mute">
              {t('events.create.selectedCount', { count: selected.size, total: others.length })}
            </span>
          )
        }
      >
        <p className="-mt-1 text-sm text-mute">
          {t('events.create.whoLabel')} {t('events.create.whoHint')}
        </p>
        {members.isPending ? (
          <Skeleton className="h-32" />
        ) : (
          <WhoList members={others} selected={selected} onChange={setSelected} />
        )}
      </Section>

      {errors.form && (
        <p
          role="alert"
          className="rounded-[0.875rem] bg-tomato-soft px-4 py-3 text-sm text-tomato-ink"
        >
          {errors.form}
        </p>
      )}

      <Button type="submit" size="lg" block loading={submitting}>
        {t('events.create.submit')}
      </Button>
    </form>
  )
}

function WhoList({
  members,
  selected,
  onChange,
}: {
  members: PlanMember[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const all = members.length > 0 && selected.size === members.length
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Chip selected={all} onClick={() => onChange(new Set(members.map((m) => m.userId)))}>
          {t('events.create.everyone')}
        </Chip>
        <Chip selected={selected.size === 0} onClick={() => onChange(new Set())}>
          {t('events.create.nobody')}
        </Chip>
      </div>
      <ul className="grid gap-1 sm:grid-cols-2">
        {members.map((m) => {
          const id = `who-${m.userId}`
          const checked = selected.has(m.userId)
          return (
            <li key={m.userId}>
              <label
                htmlFor={id}
                className="flex cursor-pointer items-center gap-3 rounded-[0.875rem] px-2 py-2 hover:bg-sunken"
              >
                <Checkbox
                  id={id}
                  checked={checked}
                  onCheckedChange={(v) => {
                    const next = new Set(selected)
                    if (v) next.add(m.userId)
                    else next.delete(m.userId)
                    onChange(next)
                  }}
                />
                <Avatar
                  name={m.displayName}
                  seed={m.userId}
                  src={planAvatarUrl(supabase, m.avatarPath)}
                  size="sm"
                />
                <span className="truncate text-[0.9375rem] font-medium">{m.displayName}</span>
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Section({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <Card padding="roomy" className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        {aside}
      </div>
      {children}
    </Card>
  )
}
