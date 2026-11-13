import {
  deleteRecurring,
  moneyErrorCode,
  moneyKeys,
  setRecurringActive,
  skipRecurring,
  type RecurringExpense,
} from '@potluck/api'
import { formatDate, t } from '@potluck/i18n'
import { toast } from '@potluck/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { moneyErrorMessage } from '@/features/expenses/money-data'

/**
 * Skip, pause or resume, and stop a repeating expense, with the toasts and cache updates every
 * screen that shows one needs (the group's list, the editor, the card on a posted copy).
 */
export function useTemplateActions(
  template: RecurringExpense,
  /** Names of people it names who left, for the message when resuming is refused. */
  departedNames?: string,
) {
  const errorText = (error: unknown) =>
    departedNames && moneyErrorCode(error) === 'split_member_not_in_group'
      ? t('expenses.recurring.resumeBlocked', { names: departedNames })
      : moneyErrorMessage(error)
  const queryClient = useQueryClient()
  const listKey = moneyKeys.recurring(template.group_id)
  const oneKey = moneyKeys.recurringOne(template.id)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: listKey })
    void queryClient.invalidateQueries({ queryKey: oneKey })
    void queryClient.invalidateQueries({ queryKey: moneyKeys.activity() })
  }
  const patch = (next: Partial<RecurringExpense>) => {
    queryClient.setQueryData<RecurringExpense[]>(listKey, (rows) =>
      rows?.map((r) => (r.id === template.id ? { ...r, ...next } : r)),
    )
    queryClient.setQueryData<RecurringExpense | null>(oneKey, (row) =>
      row ? { ...row, ...next } : row,
    )
  }

  const toggle = useMutation({
    mutationFn: (active: boolean) => setRecurringActive(supabase, template.id, active),
    onMutate: async (active) => {
      await queryClient.cancelQueries({ queryKey: listKey })
      await queryClient.cancelQueries({ queryKey: oneKey })
      const previous = {
        list: queryClient.getQueryData<RecurringExpense[]>(listKey),
        one: queryClient.getQueryData<RecurringExpense | null>(oneKey),
      }
      patch({ active })
      return previous
    },
    onError: (error, _active, previous) => {
      if (previous?.list) queryClient.setQueryData(listKey, previous.list)
      if (previous?.one) queryClient.setQueryData(oneKey, previous.one)
      toast.error(errorText(error))
    },
    onSuccess: (_data, active) => {
      toast.success(
        t(active ? 'expenses.recurring.resumedToast' : 'expenses.recurring.pausedToast', {
          description: template.description,
        }),
      )
    },
    onSettled: refresh,
  })

  const skip = useMutation({
    mutationFn: () => skipRecurring(supabase, template.id),
    onSuccess: (saved) => {
      patch(saved)
      toast.success(
        t('expenses.recurring.skippedToast', {
          description: saved.description,
          date: formatDate(saved.next_run_on, { timeZone: 'UTC', style: 'weekday' }),
        }),
      )
    },
    onError: (error) => toast.error(moneyErrorMessage(error)),
    onSettled: refresh,
  })

  const remove = useMutation({
    mutationFn: () => deleteRecurring(supabase, template.id),
    onSuccess: () => {
      toast.success(t('expenses.recurring.removedToast', { description: template.description }))
      queryClient.setQueryData(oneKey, null)
      // Posted copies lose their link to the series.
      void queryClient.invalidateQueries({ queryKey: moneyKeys.group(template.group_id) })
      void queryClient.invalidateQueries({ queryKey: [...moneyKeys.all, 'expense'] })
    },
    onError: (error) => toast.error(moneyErrorMessage(error)),
    onSettled: refresh,
  })

  return { toggle, skip, remove }
}
