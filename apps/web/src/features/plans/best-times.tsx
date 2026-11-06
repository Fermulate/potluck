import { firstName } from '@potluck/core'
import type { PlanBestSlot, PlanMember } from '@potluck/api'
import { formatDate, formatDateRange, formatTime, t } from '@potluck/i18n'
import { AvatarStack, Button, Card, ConfirmDialog, Skeleton } from '@potluck/ui'
import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { GoodToKnow, Help } from '@/features/help/help'
import { joinNames } from './format'

export interface BestTimesProps {
  slots: PlanBestSlot[] | undefined
  members: PlanMember[]
  timeZone: string
  canLock: boolean
  onLock: (startsAt: string) => Promise<unknown>
  /** Called with the slot being looked at, so the heatmap can outline it. */
  onPreview?: (slot: PlanBestSlot | null) => void
  avatarUrl?: (path: string | null) => string | null
}

/** Ranked suggestions from `best_slots`, with "Lock it in" for the organizer and admins. */
export function BestTimes({
  slots,
  members,
  timeZone,
  canLock,
  onLock,
  onPreview,
  avatarUrl,
}: BestTimesProps) {
  const [confirming, setConfirming] = useState<PlanBestSlot | null>(null)
  const people = members.filter((m) => !m.deleted)
  const byId = new Map(people.map((m) => [m.userId, m]))

  if (!slots) {
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton className="h-44" />
        <Skeleton className="h-16" />
      </div>
    )
  }

  if (slots.length === 0) {
    return (
      <Card tone="ghost" padding="roomy" className="flex flex-col gap-2">
        <p className="flex items-center gap-1.5 text-sm font-bold">
          <Sparkles aria-hidden className="size-4" />
          {t('bestTime.title')}
        </p>
        <p className="flourish text-2xl leading-tight">{t('bestTime.none')}</p>
      </Card>
    )
  }

  const [top, ...rest] = slots
  const free = (slot: PlanBestSlot) =>
    people
      .filter((m) => !slot.missing.includes(m.userId))
      .map((m) => ({ id: m.userId, name: m.displayName, src: avatarUrl?.(m.avatarPath) }))
  const missingNames = (slot: PlanBestSlot) =>
    slot.missing.map((id) => firstName(byId.get(id)?.displayName ?? '')).filter(Boolean)
  const preview = (slot: PlanBestSlot | null) => onPreview?.(slot)

  const lockLabel = (slot: PlanBestSlot) =>
    formatDateRange(slot.starts_at, slot.ends_at, { timeZone })

  return (
    <section aria-labelledby="best-times" className="flex flex-col gap-3">
      <h2 id="best-times" className="sr-only">
        {t('bestTime.title')}
      </h2>
      <Card
        tone="saffron"
        padding="roomy"
        className="flex flex-col gap-4 overflow-hidden"
        onPointerEnter={() => preview(top!)}
        onPointerLeave={() => preview(null)}
        onFocus={() => preview(top!)}
        onBlur={() => preview(null)}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-bold">
            <Sparkles aria-hidden className="size-4" />
            {t('bestTime.top')}
            <GoodToKnow
              topic="bestTimes"
              tip="bestTimes"
              align="start"
              className="ml-1 [&>button]:text-current"
            />
          </span>
          <span className="tabular text-sm font-semibold">
            {t('bestTime.score', { yes: top!.yes_count, maybe: top!.maybe_count })}
          </span>
        </div>
        <div>
          <p className="text-[2rem] leading-[1.05] font-extrabold tracking-tight text-balance">
            {formatDate(top!.starts_at, { timeZone, style: 'full' }).replace(/,? \d{4}$/, '')}
          </p>
          <p className="mt-1 tabular text-lg font-semibold">
            {formatTime(top!.starts_at, { timeZone })} - {formatTime(top!.ends_at, { timeZone })}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 [--avatar-ring:var(--pl-saffron)]">
          <div className="flex min-w-0 items-center gap-2">
            <AvatarStack
              people={free(top!)}
              max={5}
              size="sm"
              label={t('availability.freeCount', { count: free(top!).length })}
            />
            <span className="truncate text-sm">
              {top!.missing.length === 0
                ? t('bestTime.everyoneCanMake')
                : t('bestTime.missing', { names: joinNames(missingNames(top!), 2) })}
            </span>
          </div>
          {canLock && (
            <Button size="sm" variant="ink" onClick={() => setConfirming(top!)}>
              {t('events.lock')}
            </Button>
          )}
        </div>
      </Card>

      {rest.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="px-1 text-sm font-bold text-mute">{t('bestTime.others')}</h3>
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-card">
            {rest.map((slot) => (
              <li
                key={slot.starts_at}
                className="flex items-center gap-3 px-4 py-3"
                onPointerEnter={() => preview(slot)}
                onPointerLeave={() => preview(null)}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.9375rem] font-semibold">
                    {formatDate(slot.starts_at, { timeZone, style: 'weekday' })}
                    <span className="tabular font-medium text-mute">
                      {', '}
                      {formatTime(slot.starts_at, { timeZone })}
                    </span>
                  </p>
                  <p className="truncate text-xs text-mute">
                    <span className="tabular font-semibold">
                      {t('bestTime.score', { yes: slot.yes_count, maybe: slot.maybe_count })}
                    </span>
                    {'. '}
                    {slot.missing.length === 0
                      ? t('bestTime.everyoneCanMake')
                      : t('bestTime.missing', { names: joinNames(missingNames(slot), 2) })}
                  </p>
                </div>
                {canLock && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirming(slot)}
                    onFocus={() => preview(slot)}
                    onBlur={() => preview(null)}
                    aria-label={`${t('bestTime.lockIn')}: ${lockLabel(slot)}`}
                  >
                    {t('bestTime.lockIn')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t('events.lockTitle')}
        description={
          confirming ? t('events.lockConfirm', { date: lockLabel(confirming) }) : undefined
        }
        confirmLabel={t('events.lock')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        onConfirm={async () => {
          if (confirming) await onLock(confirming.starts_at)
        }}
      >
        <Help topic="lockIn" showLabel />
      </ConfirmDialog>
    </section>
  )
}
