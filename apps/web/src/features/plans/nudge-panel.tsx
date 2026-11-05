import {
  plansKeys,
  requestAvailability,
  type PlanAvailabilityRequest,
  type PlanMember,
} from '@potluck/api'
import { formatRelative, t } from '@potluck/i18n'
import { Avatar, Button, Card, ProgressRing, toast } from '@potluck/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BellRing, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { planErrorMessage } from './format'

export interface NudgePanelProps {
  eventId: string
  members: PlanMember[]
  /** Members who have painted at least one slot. */
  responded: ReadonlySet<string>
  requests: PlanAvailabilityRequest[]
  viewerId: string
  timeZone: string
  avatarUrl?: (path: string | null) => string | null
}

/** Who has not added their times yet, with one tap to nudge them. */
export function NudgePanel({
  eventId,
  members,
  responded,
  requests,
  viewerId,
  timeZone,
  avatarUrl,
}: NudgePanelProps) {
  const queryClient = useQueryClient()
  const people = members.filter((m) => !m.deleted)
  const waiting = people.filter((m) => !responded.has(m.userId))
  const nudgeable = waiting.filter((m) => m.userId !== viewerId)
  const requestFor = new Map(requests.map((r) => [r.user_id, r]))
  const done = people.length - waiting.length

  const nudge = useMutation({
    mutationFn: (ids: string[]) => requestAvailability(supabase, eventId, ids),
    onSuccess: (count) => {
      toast.success(t('events.requestSent', { count }))
      void queryClient.invalidateQueries({ queryKey: plansKeys.requests(eventId) })
    },
    onError: (error) => toast.error(planErrorMessage(error)),
  })

  return (
    <Card padding="none" className="overflow-hidden [--avatar-ring:var(--pl-card)]">
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <ProgressRing
          value={people.length ? done / people.length : 0}
          label={t('events.respondedCount', { count: done, total: people.length })}
          valueText={t('events.respondedCount', { count: done, total: people.length })}
          size={44}
          thickness={4}
          tone="olive"
        >
          <span className="tabular text-[0.6875rem] font-bold">
            {done}/{people.length}
          </span>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">{t('events.nudgeTitle')}</h2>
          <p className="text-sm text-mute">
            {t('events.respondedCount', { count: done, total: people.length })}
          </p>
        </div>
        {nudgeable.length > 1 && (
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<BellRing aria-hidden />}
            loading={nudge.isPending && nudge.variables?.length === nudgeable.length}
            onClick={() => nudge.mutate(nudgeable.map((m) => m.userId))}
          >
            {t('events.nudgeAll')}
          </Button>
        )}
      </div>
      {waiting.length === 0 ? (
        <p className="flex items-center gap-2 border-t border-line px-4 py-3 text-sm text-olive-ink">
          <Check aria-hidden className="size-4" />
          {t('events.allResponded')}
        </p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {waiting.map((m) => {
            const request = requestFor.get(m.userId)
            const nudgedAt = request && !request.responded_at ? request.requested_at : null
            const isMe = m.userId === viewerId
            return (
              <li key={m.userId} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar
                  name={m.displayName}
                  seed={m.userId}
                  src={avatarUrl?.(m.avatarPath)}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {isMe ? t('common.you') : m.displayName}
                  </p>
                  {nudgedAt && (
                    <p className="truncate text-xs text-mute">
                      {t('events.nudged', { when: formatRelative(nudgedAt, { timeZone }) })}
                    </p>
                  )}
                </div>
                {!isMe && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={
                      nudge.isPending &&
                      nudge.variables?.length === 1 &&
                      nudge.variables[0] === m.userId
                    }
                    onClick={() => nudge.mutate([m.userId])}
                    aria-label={`${t('events.nudge')} ${m.displayName}`}
                  >
                    {nudgedAt ? t('events.nudgeAgain') : t('events.nudge')}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
