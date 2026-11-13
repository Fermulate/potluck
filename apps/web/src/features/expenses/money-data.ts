import {
  groupKeys,
  insightsKeys,
  moneyKeys,
  plansKeys,
  moneyQueries,
  myProfileQueryOptions,
  type MoneyPerson,
} from '@potluck/api'
import { firstName } from '@potluck/core'
import { t } from '@potluck/i18n'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useUserId } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { resolveTimeZone } from '@/lib/locale'
import { useBatchedInvalidate, useRealtime } from '@/lib/realtime'
import { supabase } from '@/lib/supabase'

/** The viewer's profile. Shares the Me cache entry, so screens never fetch it twice. */
export function useViewer() {
  return useQuery(myProfileQueryOptions(supabase, useUserId()))
}

/** Everyone the viewer can see, by id. */
export function usePeople(): Map<string, MoneyPerson> {
  const { data } = useQuery(moneyQueries.people(supabase))
  return useMemo(() => new Map((data ?? []).map((p) => [p.id, p])), [data])
}

export function useMoneyGroup(groupId: string | undefined) {
  return useQuery({ ...moneyQueries.group(supabase, groupId ?? ''), enabled: !!groupId })
}

export function useGroupExpenses(groupId: string) {
  return useQuery(moneyQueries.expenses(supabase, groupId))
}

export function useGroupSettlements(groupId: string) {
  return useQuery(moneyQueries.settlements(supabase, groupId))
}

/** The viewer's IANA zone, for rendering timestamps. Falls back to the browser's. */
export function useTimeZone(): string {
  return resolveTimeZone(useViewer().data?.timezone)
}

/**
 * Keeps a group's money queries fresh: any change to its expenses, payments, or activity (which
 * covers comments) refetches them.
 */
export function useGroupMoneyRealtime(groupId: string | undefined) {
  const bump = useBatchedInvalidate()
  const filter = `group_id=eq.${groupId}`
  useRealtime(
    groupId ? `money:${groupId}` : null,
    [
      { table: 'expenses', filter },
      { table: 'settlements', filter },
      { table: 'activity', event: 'INSERT', filter },
    ],
    (payload) => {
      if (!groupId) return
      if (payload.table === 'activity') {
        const row = payload.new as { verb?: string; data?: { expense_id?: string } }
        if (row.verb === 'comment.created' && row.data?.expense_id) {
          bump(moneyKeys.comments(row.data.expense_id))
        }
        bump(moneyKeys.activity())
        return
      }
      const id = payload.table === 'expenses' ? (payload.new as { id?: string } | null)?.id : null
      bump(moneyKeys.group(groupId), ...(id ? [moneyKeys.expense(id)] : []))
    },
  )
}

/**
 * Everything a new or changed expense or payment moves: the group's money screens, the feed,
 * and the balances shown on the group list and the home screen (which otherwise stay cached for
 * up to the default stale time after you come back to them).
 */
export function invalidateMoney(queryClient: QueryClient, groupId: string, expenseId?: string) {
  void queryClient.invalidateQueries({ queryKey: moneyKeys.group(groupId) })
  if (expenseId) void queryClient.invalidateQueries({ queryKey: moneyKeys.expense(expenseId) })
  void queryClient.invalidateQueries({ queryKey: moneyKeys.activity() })
  void queryClient.invalidateQueries({ queryKey: groupKeys.all })
  void queryClient.invalidateQueries({ queryKey: [...plansKeys.all, 'home-balances'] })
  // Search results and the totals across groups.
  void queryClient.invalidateQueries({ queryKey: insightsKeys.all })
}

/** First name, or "You" for the viewer. */
export function useNameOf() {
  const people = usePeople()
  const me = useUserId()
  return useMemo(
    () =>
      (id: string | null | undefined, { lower = false }: { lower?: boolean } = {}) => {
        if (!id) return t('activity.someone')
        if (id === me) return lower ? t('common.youLower') : t('common.you')
        return firstName(people.get(id)?.display_name ?? t('activity.someone'))
      },
    [people, me],
  )
}

/** Turns an RPC failure into a sentence for a toast or field error. */
export function moneyErrorMessage(error: unknown): string {
  return errorMessage(error, 'expenses.errors')
}
