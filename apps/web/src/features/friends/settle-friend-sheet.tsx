import { groupKeys, paymentKeys, settleWithFriend, type Friend } from '@potluck/api'
import { firstName, type FriendTotal } from '@potluck/core'
import { formatMoney, t } from '@potluck/i18n'
import { Button, Field, Input, Sheet, SheetContent, cn, toast } from '@potluck/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCheck } from 'lucide-react'
import { useState } from 'react'
import { GroupTile } from '@/features/groups/group-bits'
import { useMyGroups } from '@/features/groups/use-groups'
import { Help } from '@/features/help/help'
import { todayIn } from '@/features/expenses/format'
import { invalidateMoney, moneyErrorMessage, useTimeZone } from '@/features/expenses/money-data'
import { supabase } from '@/lib/supabase'

/**
 * Settle up with a friend across every group you share: one payment per open group, in that
 * group's currency, recorded together by `settle_with_friend`.
 */
export function SettleFriendSheet({
  friend,
  total,
  open,
  onOpenChange,
}: {
  friend: Friend
  total: FriendTotal
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const timeZone = useTimeZone()
  const today = todayIn(timeZone)
  const { data: groups = [] } = useMyGroups()
  const [day, setDay] = useState(today)
  const name = firstName(friend.display_name)
  const count = total.settleable.length
  const groupOf = (id: string) => groups.find((g) => g.id === id)

  const settle = useMutation({
    mutationFn: () =>
      settleWithFriend(supabase, friend.id, { settledOn: day === today ? null : day }),
    onSuccess: (rows) => {
      for (const id of new Set(rows.map((r) => r.group_id))) invalidateMoney(queryClient, id)
      void queryClient.invalidateQueries({ queryKey: paymentKeys.friendBalances() })
      void queryClient.invalidateQueries({ queryKey: groupKeys.all })
      toast.success(
        rows.length > 0
          ? t('friends.settle.done', { name })
          : t('friends.settle.nothing', { name }),
      )
      onOpenChange(false)
    },
    onError: (error) => toast.error(moneyErrorMessage(error)),
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={t('friends.settle.title', { name })}
        description={t('friends.settle.body')}
        closeLabel={t('common.close')}
        footer={
          <Button
            block
            size="lg"
            leadingIcon={<CheckCheck />}
            loading={settle.isPending}
            disabled={count === 0}
            onClick={() => settle.mutate()}
          >
            {t('friends.settle.record', { count })}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <ul className="divide-y divide-line rounded-card border border-line">
            {[...total.settleable, ...total.archived].map((row) => {
              const g = groupOf(row.groupId)
              const amount = formatMoney(Math.abs(row.netCents), row.currency)
              return (
                <li
                  key={row.groupId}
                  className={cn('flex items-center gap-3 px-3 py-3', row.archived && 'opacity-55')}
                >
                  <GroupTile emoji={g?.emoji ?? null} color={g?.color ?? null} size="sm" />
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {g?.is_direct ? friend.display_name : (g?.name ?? '')}
                  </span>
                  <span
                    className={cn(
                      'tabular text-sm font-bold',
                      row.netCents > 0 ? 'text-saffron-ink' : 'text-tomato-ink',
                    )}
                  >
                    {row.netCents > 0
                      ? t('friends.settle.owesYou', { amount })
                      : t('friends.settle.youOwe', { amount })}
                  </span>
                </li>
              )
            })}
          </ul>
          {total.archived.length > 0 && (
            <p className="text-sm text-mute">
              {t('friends.settle.archived', { count: total.archived.length })}
            </p>
          )}
          <Field label={t('friends.settle.date')}>
            <Input
              type="date"
              value={day}
              max={today}
              onChange={(e) => e.target.value && setDay(e.target.value)}
            />
          </Field>
          <Help topic="settleFriend" showLabel />
        </div>
      </SheetContent>
    </Sheet>
  )
}
