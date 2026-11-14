import { canSplitWithQueryOptions, myBlocksQueryOptions } from '@potluck/api'
import { t } from '@potluck/i18n'
import { useQuery } from '@tanstack/react-query'
import { useMoneyGroup } from '@/features/expenses/money-data'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

/**
 * Why no new expense can go in with this person, or null when one can. A block either way stops
 * new expenses (the server refuses them), so say so up front. Which side blocked is only told to
 * the person who did it; the other side gets the plain no `can_split_with` gives.
 */
export function useSplitNote(personId: string | undefined, name: string): string | null {
  const me = useUserId()
  const blocks = useQuery({ ...myBlocksQueryOptions(supabase, me), enabled: !!personId })
  const canSplit = useQuery({
    ...canSplitWithQueryOptions(supabase, personId ?? ''),
    enabled: !!personId,
  })
  if (!personId) return null
  if (blocks.data?.some((b) => b.user_id === personId)) {
    return t('people.friendPage.youBlocked', { name })
  }
  return canSplit.data === false ? t('errors.codes.not_a_friend') : null
}

/**
 * Whether the viewer is the blocked side of this 1:1 tab, the rule the server applies to its
 * payments (`private.freeze_blocked_direct_money`): someone blocked there may record a new payment
 * and change only the ones they recorded. True when `can_split_with` says no and the viewer did
 * not block the other person themselves (a block either way makes it say no). False in any
 * other group, and undefined while either answer is on its way.
 */
export function useBlockedInTab(groupId: string | undefined): boolean | undefined {
  const me = useUserId()
  const group = useMoneyGroup(groupId)
  const other = group.data?.is_direct ? group.data.members.find((m) => m.id !== me) : undefined
  const blocks = useQuery({ ...myBlocksQueryOptions(supabase, me), enabled: !!other })
  const canSplit = useQuery({
    ...canSplitWithQueryOptions(supabase, other?.id ?? ''),
    enabled: !!other,
  })
  if (!group.data) return undefined
  // Without an answer the controls show and the server's refusal says why.
  if (!other || canSplit.isError || blocks.isError) return false
  if (canSplit.data === undefined || blocks.data === undefined) return undefined
  return canSplit.data === false && !blocks.data.some((b) => b.user_id === other.id)
}

/** The same note inside a 1:1 tab, about the other person in it. Null in any other group. */
export function useTabSplitNote(groupId: string | undefined): string | null {
  const me = useUserId()
  const group = useMoneyGroup(groupId)
  const other = group.data?.is_direct ? group.data.members.find((m) => m.id !== me) : undefined
  return useSplitNote(other?.id, other?.display_name ?? '')
}
