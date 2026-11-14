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

/** The same note inside a 1:1 tab, about the other person in it. Null in any other group. */
export function useTabSplitNote(groupId: string | undefined): string | null {
  const me = useUserId()
  const group = useMoneyGroup(groupId)
  const other = group.data?.is_direct ? group.data.members.find((m) => m.id !== me) : undefined
  return useSplitNote(other?.id, other?.display_name ?? '')
}
