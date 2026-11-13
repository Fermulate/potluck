import { groupKeys, paymentKeys, settleWithFriend, type Friend } from '@potluck/api'
import {
  firstName,
  parseAmount,
  plainAmount,
  type FriendBalanceRow,
  type FriendTotal,
} from '@potluck/core'
import { formatMoney, t } from '@potluck/i18n'
import { Button, Checkbox, Field, Input, Sheet, SheetContent, cn, toast } from '@potluck/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCheck } from 'lucide-react'
import { useState } from 'react'
import { GroupTile } from '@/features/groups/group-bits'
import { useMyGroups } from '@/features/groups/use-groups'
import { Help } from '@/features/help/help'
import { todayIn } from '@/features/expenses/format'
import { invalidateMoney, moneyErrorMessage, useTimeZone } from '@/features/expenses/money-data'
import { supabase } from '@/lib/supabase'

interface Pick {
  on: boolean
  /** What was typed, in the group currency. */
  text: string
}

/** "$", "€", or the code when a currency has no short symbol ("CHF"). */
function currencySymbol(currency: string): string {
  try {
    return (
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
      })
        .formatToParts(0)
        .find((p) => p.type === 'currency')?.value ?? currency
    )
  } catch {
    return currency
  }
}

/** Minor units typed for a group, or null when it is not a usable amount for that debt. */
function pickedCents(row: FriendBalanceRow, pick: Pick): number | null {
  const cents = parseAmount(pick.text, row.currency)
  return cents !== null && cents > 0 && cents <= Math.abs(row.netCents) ? cents : null
}

/**
 * Settle up with a friend across the groups you share: one payment per picked group, in that
 * group's currency, recorded together by `settle_with_friend`. Every open group starts picked
 * with its full amount; untick a group to leave it, or lower an amount to pay part of it.
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
  const [picks, setPicks] = useState<Record<string, Pick>>(() =>
    Object.fromEntries(
      total.settleable.map((row) => [
        row.groupId,
        { on: true, text: plainAmount(Math.abs(row.netCents), row.currency) },
      ]),
    ),
  )
  const name = firstName(friend.display_name)
  const groupOf = (id: string) => groups.find((g) => g.id === id)
  const groupName = (id: string) => {
    const g = groupOf(id)
    return g?.is_direct ? friend.display_name : (g?.name ?? '')
  }

  const chosen = total.settleable.filter((row) => picks[row.groupId]?.on)
  const invalid = chosen.some((row) => pickedCents(row, picks[row.groupId]!) === null)
  const everything =
    chosen.length === total.settleable.length &&
    chosen.every((row) => pickedCents(row, picks[row.groupId]!) === Math.abs(row.netCents))
  const count = chosen.length

  const settle = useMutation({
    mutationFn: () =>
      settleWithFriend(supabase, friend.id, {
        settledOn: day === today ? null : day,
        // Everything in full needs no list, so groups that changed meanwhile settle as they are.
        amounts: everything
          ? undefined
          : Object.fromEntries(
              chosen.map((row) => [row.groupId, pickedCents(row, picks[row.groupId]!)!]),
            ),
      }),
    onSuccess: (rows) => {
      for (const id of new Set(rows.map((r) => r.group_id))) invalidateMoney(queryClient, id)
      void queryClient.invalidateQueries({ queryKey: paymentKeys.friendBalances() })
      void queryClient.invalidateQueries({ queryKey: groupKeys.all })
      toast.success(
        rows.length === 0
          ? t('friends.settle.nothing', { name })
          : everything
            ? t('friends.settle.done', { name })
            : t('friends.settle.partDone', { count: rows.length }),
      )
      onOpenChange(false)
    },
    onError: (error) => toast.error(moneyErrorMessage(error)),
  })

  const update = (groupId: string, patch: Partial<Pick>) =>
    setPicks((all) => ({ ...all, [groupId]: { ...all[groupId]!, ...patch } }))

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
            disabled={count === 0 || invalid}
            onClick={() => settle.mutate()}
          >
            {t('friends.settle.record', { count })}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <ul className="divide-y divide-line rounded-card border border-line">
            {total.settleable.map((row) => {
              const g = groupOf(row.groupId)
              const label = groupName(row.groupId)
              const full = formatMoney(Math.abs(row.netCents), row.currency)
              const pick = picks[row.groupId]!
              const bad = pick.on && pickedCents(row, pick) === null
              return (
                <li key={row.groupId} className="flex flex-col gap-2 px-3 py-3">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={pick.on}
                      onCheckedChange={(on) => update(row.groupId, { on: on === true })}
                      aria-label={t('friends.settle.include', { group: label })}
                    />
                    <GroupTile emoji={g?.emoji ?? null} color={g?.color ?? null} size="sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-semibold">{label}</span>
                      <span
                        className={cn(
                          'tabular text-sm font-medium',
                          row.netCents > 0 ? 'text-saffron-ink' : 'text-tomato-ink',
                        )}
                      >
                        {row.netCents > 0
                          ? t('friends.settle.owesYou', { amount: full })
                          : t('friends.settle.youOwe', { amount: full })}
                      </span>
                    </span>
                    <Input
                      value={pick.text}
                      onChange={(e) => update(row.groupId, { text: e.target.value })}
                      disabled={!pick.on}
                      inputMode="decimal"
                      aria-label={t('friends.settle.amountFor', {
                        group: label,
                        currency: row.currency,
                      })}
                      aria-invalid={bad || undefined}
                      // Groups in different currencies sit side by side: say which one this is.
                      leading={
                        <span aria-hidden className="text-sm font-semibold">
                          {currencySymbol(row.currency)}
                        </span>
                      }
                      className="h-10 w-28 text-right tabular"
                      style={{
                        paddingLeft: `${1.4 + currencySymbol(row.currency).length * 0.55}rem`,
                      }}
                    />
                  </div>
                  {bad && (
                    <p role="alert" className="pl-9 text-sm font-medium text-tomato-ink">
                      {t('friends.settle.upTo', { amount: full })}
                    </p>
                  )}
                </li>
              )
            })}
            {total.archived.map((row) => (
              <li key={row.groupId} className="flex items-center gap-3 px-3 py-3 opacity-55">
                <span aria-hidden className="w-[1.375rem]" />
                <GroupTile
                  emoji={groupOf(row.groupId)?.emoji ?? null}
                  color={groupOf(row.groupId)?.color ?? null}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {groupName(row.groupId)}
                </span>
                <span className="tabular text-sm font-medium text-mute">
                  {formatMoney(Math.abs(row.netCents), row.currency)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-mute">{t('friends.settle.pickHint')}</p>
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
