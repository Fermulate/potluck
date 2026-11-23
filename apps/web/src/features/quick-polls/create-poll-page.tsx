import { createQuickPoll } from '@potluck/api'
import {
  dayKey,
  QUICK_POLL_DEFAULT_PEOPLE,
  QUICK_POLL_MAX_DAYS,
  QUICK_POLL_MAX_PEOPLE,
  QUICK_POLL_MIN_PEOPLE,
  QUICK_POLL_TITLE_MAX,
  quickPollWindowFits,
  type QuickPollTtl,
} from '@potluck/core'
import { t } from '@potluck/i18n'
import { Button, Card, Field, Input, SegmentedControl, Select, Switch } from '@potluck/ui'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, Minus, Plus } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import {
  addDays,
  durationOptions,
  type PollWindow,
  type WindowField,
} from '@/features/plans/window'
import { WindowFields } from '@/features/plans/window-fields'
import { Notice, PublicFrame } from '@/features/shell/public-page'
import { errorMessage } from '@/lib/errors'
import { detectTimezone } from '@/lib/locale'
import { supabase } from '@/lib/supabase'
import { pollMemory } from './poll-memory'

/** Everything past the title, the days and the length: sensible defaults behind "More options". */
interface PollSettings {
  ttl: QuickPollTtl
  namesRequired: boolean
  maxPeople: number
}

const DEFAULT_SETTINGS: PollSettings = {
  ttl: '7d',
  namesRequired: true,
  maxPeople: QUICK_POLL_DEFAULT_PEOPLE,
}

const TTL_LABEL = {
  '24h': () => t('quickPolls.create.expiry.day'),
  '7d': () => t('quickPolls.create.expiry.week'),
} satisfies Record<QuickPollTtl, () => string>

/** One slot size for every quick poll: fine enough for a call, small enough to paint fast. */
const SLOT_MINUTES = 30

/**
 * `/poll`: anyone, signed in or not, makes an availability poll. Every field starts on a sensible
 * value, so the first poll is one tap away; the rarer settings wait behind "More options". On
 * success the browser keeps the creator token and the poll page takes over.
 */
export function CreatePollPage() {
  const navigate = useNavigate()
  const timeZone = useMemo(() => detectTimezone(), [])
  const [today] = useState(() => dayKey(Date.now(), timeZone))
  const [title, setTitle] = useState('')
  const [pollWindow, setPollWindow] = useState<PollWindow>(() => ({
    windowStart: addDays(today, 1),
    windowEnd: addDays(today, 7),
    dayStartMinute: 10 * 60,
    dayEndMinute: 22 * 60,
  }))
  const [duration, setDuration] = useState(60)
  const [settings, setSettings] = useState<PollSettings>(DEFAULT_SETTINGS)
  const [errors, setErrors] = useState<Partial<Record<WindowField, string>>>({})

  const create = useMutation({
    mutationFn: () =>
      createQuickPoll(supabase, {
        title: title.trim() || null,
        timeZone,
        windowStart: pollWindow.windowStart,
        windowEnd: pollWindow.windowEnd,
        dayStartMinute: pollWindow.dayStartMinute,
        dayEndMinute: pollWindow.dayEndMinute,
        durationMinutes: duration,
        slotMinutes: SLOT_MINUTES,
        ttl: settings.ttl,
        namesRequired: settings.namesRequired,
        maxPeople: settings.maxPeople,
      }),
    onSuccess: async (created) => {
      pollMemory.write(created.code, { token: created.creatorToken, name: '' })
      await navigate({ to: '/p/$code', params: { code: created.code } })
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next: Partial<Record<WindowField, string>> = {}
    if (!quickPollWindowFits(pollWindow.windowStart, pollWindow.windowEnd)) {
      next.window_end = t('quickPolls.errors.invalid_quick_poll_window')
    }
    if (pollWindow.dayEndMinute - pollWindow.dayStartMinute < SLOT_MINUTES) {
      next.day_end_minute = t('quickPolls.errors.invalid_quick_poll_hours')
    }
    setErrors(next)
    const first = Object.keys(next)[0]
    if (first) {
      document.getElementById(`poll-${first}`)?.focus()
      return
    }
    create.mutate()
  }

  const summary = t('quickPolls.create.summary', {
    names: settings.namesRequired
      ? t('quickPolls.create.namesOn')
      : t('quickPolls.create.namesOff'),
    max: settings.maxPeople,
    expiry: TTL_LABEL[settings.ttl](),
  })

  return (
    <PublicFrame wide>
      <div className="mt-6 grid gap-6 lg:mt-12 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start lg:gap-12">
        <header className="flex flex-col gap-3 lg:sticky lg:top-8 lg:gap-5">
          <h1 className="font-display text-[2.75rem] leading-[0.95] text-balance sm:text-5xl lg:text-[3.5rem]">
            {t('quickPolls.create.title')}
          </h1>
          <p className="max-w-[40ch] text-pretty text-mute lg:text-lg">
            {t('quickPolls.create.intro')}
          </p>
        </header>

        <form noValidate onSubmit={submit} className="flex min-w-0 flex-col gap-5">
          <Card padding="roomy" className="flex flex-col gap-5">
            <Field label={t('quickPolls.create.titleLabel')} hint={t('common.optional')}>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('quickPolls.defaultTitle')}
                maxLength={QUICK_POLL_TITLE_MAX}
                enterKeyHint="next"
              />
            </Field>
            <h2 className="-mb-1 text-lg font-bold tracking-tight">
              {t('quickPolls.create.when')}
            </h2>
            <WindowFields
              value={pollWindow}
              onChange={setPollWindow}
              today={today}
              maxDays={QUICK_POLL_MAX_DAYS}
              errors={errors}
              idPrefix="poll"
            />
            <Field label={t('events.create.durationLabel')}>
              <Select
                value={String(duration)}
                onValueChange={(v) => setDuration(Number(v))}
                options={durationOptions()}
              />
            </Field>
            <p className="-mt-2 text-xs text-mute">
              {t('quickPolls.page.timezoneNote', { zone: timeZone })}
            </p>
          </Card>

          <MoreOptions summary={summary} settings={settings} onChange={setSettings} />

          {create.isError && <Notice>{errorMessage(create.error, 'quickPolls.errors')}</Notice>}
          <div className="flex flex-col gap-3">
            <Button type="submit" size="lg" block loading={create.isPending}>
              {t('quickPolls.create.submit')}
            </Button>
            <p className="text-center text-sm text-mute">{t('quickPolls.create.footnote')}</p>
          </div>
        </form>
      </div>
    </PublicFrame>
  )
}

/** Names, the seat cap and how long the poll stays open, folded away with a one line summary. */
function MoreOptions({
  summary,
  settings,
  onChange,
}: {
  summary: string
  settings: PollSettings
  onChange: (next: PollSettings) => void
}) {
  const people = settings.maxPeople
  const setPeople = (n: number) =>
    onChange({
      ...settings,
      maxPeople: Math.min(QUICK_POLL_MAX_PEOPLE, Math.max(QUICK_POLL_MIN_PEOPLE, n)),
    })
  return (
    <details className="group rounded-card border border-line bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-card px-5 py-4 sm:px-6 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-semibold">{t('quickPolls.create.more')}</span>
          <span className="text-sm text-mute">{summary}</span>
        </span>
        <ChevronDown
          aria-hidden
          className="size-5 shrink-0 text-mute transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="flex flex-col gap-5 border-t border-line px-5 pt-4 pb-5 sm:px-6">
        <Switch
          label={t('quickPolls.create.namesLabel')}
          description={t('quickPolls.create.namesHint')}
          checked={settings.namesRequired}
          onCheckedChange={(namesRequired) => onChange({ ...settings, namesRequired })}
        />
        <Field
          label={t('quickPolls.create.maxLabel')}
          hint={t('quickPolls.create.maxHint', {
            min: QUICK_POLL_MIN_PEOPLE,
            max: QUICK_POLL_MAX_PEOPLE,
          })}
        >
          <div className="flex h-12 items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="size-11 px-0"
              aria-label={t('quickPolls.create.fewer')}
              disabled={people <= QUICK_POLL_MIN_PEOPLE}
              onClick={() => setPeople(people - 1)}
            >
              <Minus aria-hidden className="size-4" />
            </Button>
            <output aria-live="polite" className="w-10 text-center tabular text-xl font-extrabold">
              {people}
            </output>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="size-11 px-0"
              aria-label={t('quickPolls.create.morePeople')}
              disabled={people >= QUICK_POLL_MAX_PEOPLE}
              onClick={() => setPeople(people + 1)}
            >
              <Plus aria-hidden className="size-4" />
            </Button>
          </div>
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">{t('quickPolls.create.expiryLabel')}</span>
          <SegmentedControl<QuickPollTtl>
            label={t('quickPolls.create.expiryLabel')}
            block
            size="sm"
            value={settings.ttl}
            onValueChange={(ttl) => onChange({ ...settings, ttl })}
            options={(Object.keys(TTL_LABEL) as QuickPollTtl[]).map((ttl) => ({
              value: ttl,
              label: TTL_LABEL[ttl](),
            }))}
          />
        </div>
      </div>
    </details>
  )
}
