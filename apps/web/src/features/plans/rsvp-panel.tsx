import type { PlanMember, PlanRsvp, RsvpStatus } from '@potluck/api'
import { formatDate, t } from '@potluck/i18n'
import { AvatarStack, Card, cn } from '@potluck/ui'
import { Check, CircleHelp, X } from 'lucide-react'
import { useNow } from './use-now'
import { useRsvp } from './use-rsvp'

const OPTIONS: { value: RsvpStatus; icon: typeof Check; tone: string }[] = [
  { value: 'going', icon: Check, tone: 'border-olive bg-olive text-on-olive' },
  { value: 'maybe', icon: CircleHelp, tone: 'border-saffron bg-saffron text-on-saffron' },
  { value: 'declined', icon: X, tone: 'border-ink bg-ink text-paper' },
]

export interface RsvpPanelProps {
  eventId: string
  rsvps: PlanRsvp[]
  members: PlanMember[]
  viewerId: string
  deadline: string | null
  timeZone: string
  avatarUrl?: (path: string | null) => string | null
}

export function RsvpPanel({
  eventId,
  rsvps,
  members,
  viewerId,
  deadline,
  timeZone,
  avatarUrl,
}: RsvpPanelProps) {
  const rsvp = useRsvp(eventId, viewerId)
  const now = useNow()
  const mine = rsvps.find((r) => r.user_id === viewerId)?.status
  const byStatus = new Map(rsvps.map((r) => [r.user_id, r.status]))
  const people = members.filter((m) => !m.deleted)
  const face = (m: PlanMember) => ({
    id: m.userId,
    name: m.displayName,
    src: avatarUrl?.(m.avatarPath),
  })
  const groups: { label: string; people: PlanMember[] }[] = [
    {
      label: t('rsvp.status.going'),
      people: people.filter((m) => byStatus.get(m.userId) === 'going'),
    },
    {
      label: t('rsvp.status.maybe'),
      people: people.filter((m) => byStatus.get(m.userId) === 'maybe'),
    },
    {
      label: t('rsvp.status.declined'),
      people: people.filter((m) => byStatus.get(m.userId) === 'declined'),
    },
    { label: t('rsvp.noReply'), people: people.filter((m) => !byStatus.has(m.userId)) },
  ]
  const deadlinePassed = deadline ? Date.parse(deadline) < now : false

  return (
    <Card padding="roomy" className="flex flex-col gap-4 [--avatar-ring:var(--pl-card)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold tracking-tight">{t('rsvp.title')}</h2>
        {deadline && (
          <span className={cn('text-sm', deadlinePassed ? 'text-tomato-ink' : 'text-mute')}>
            {t(deadlinePassed ? 'rsvp.deadlinePassed' : 'rsvp.deadline', {
              date: formatDate(deadline, { timeZone, style: 'weekday' }),
            })}
          </span>
        )}
      </div>
      <div
        role="radiogroup"
        aria-label={t('rsvp.title')}
        aria-disabled={deadlinePassed || undefined}
        className="grid grid-cols-3 gap-2"
      >
        {OPTIONS.map(({ value, icon: Icon, tone }) => {
          const selected = mine === value
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              // Answers close at the deadline; the chosen one stays lit so you can see it.
              disabled={deadlinePassed}
              onClick={() => !selected && rsvp.mutate(value)}
              className={cn(
                'flex h-14 flex-col items-center justify-center gap-0.5 rounded-[0.875rem] border text-sm font-bold transition-[background-color,border-color,transform] duration-150 active:scale-[0.97] disabled:pointer-events-none',
                selected ? tone : 'border-line-strong bg-card text-ink hover:border-ink/40',
                deadlinePassed && !selected && 'opacity-45',
              )}
            >
              <Icon aria-hidden className="size-4" />
              {t(`rsvp.short.${value}`)}
            </button>
          )
        })}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {groups.map((g) => (
          <div key={g.label} className="flex min-w-0 flex-col gap-1.5">
            <dt className="text-xs font-semibold text-mute">
              {g.label} <span className="tabular">{g.people.length}</span>
            </dt>
            <dd className="min-h-6">
              {g.people.length > 0 ? (
                <AvatarStack
                  people={g.people.map(face)}
                  size="xs"
                  max={4}
                  label={g.people.map((p) => p.displayName).join(', ')}
                />
              ) : (
                <span
                  aria-hidden
                  className="block size-6 rounded-full border border-dashed border-line-strong"
                />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}
