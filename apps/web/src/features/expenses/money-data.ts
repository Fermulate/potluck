import { moneyErrorCode, moneyKeys, moneyQueries, type MoneyPerson } from '@potluck/api'
import { hasMessage, t } from '@potluck/i18n'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export function useViewer() {
  return useQuery(moneyQueries.viewer(supabase))
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
  const { data } = useViewer()
  return data?.timezone && data.timezone !== 'UTC'
    ? data.timezone
    : (Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC')
}

/**
 * Keeps a group's money queries fresh: any change to its expenses, payments, or activity (which
 * covers comments) refetches them.
 */
export function useGroupMoneyRealtime(groupId: string | undefined) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!groupId) return
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: moneyKeys.group(groupId) })
    }
    const filter = `group_id=eq.${groupId}`
    const channel = supabase
      .channel(`money:${groupId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter }, (p) => {
        invalidate()
        const id = (p.new as { id?: string } | null)?.id
        if (id) void queryClient.invalidateQueries({ queryKey: moneyKeys.expense(id) })
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settlements', filter },
        invalidate,
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'activity', filter },
        (p) => {
          const row = p.new as { verb?: string; data?: { expense_id?: string } }
          if (row.verb === 'comment.created' && row.data?.expense_id) {
            void queryClient.invalidateQueries({
              queryKey: moneyKeys.comments(row.data.expense_id),
            })
          }
          void queryClient.invalidateQueries({ queryKey: moneyKeys.activity() })
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [groupId, queryClient])
}

/** Public URL for a profile photo in the `avatars` bucket. */
export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
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

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/** Turns an RPC failure into a sentence for a toast or field error. */
export function moneyErrorMessage(error: unknown): string {
  const code = moneyErrorCode(error)
  if (code) {
    const key = `expenses.errors.${code}`
    if (hasMessage(key)) return t(key as 'expenses.errors.not_allowed')
  }
  if (error instanceof TypeError) return t('errors.network')
  return t('errors.generic')
}
