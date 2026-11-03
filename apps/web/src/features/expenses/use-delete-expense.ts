import { deleteExpense, moneyKeys, restoreExpense, type ExpenseWithSplits } from '@potluck/api'
import { t } from '@potluck/i18n'
import { toast } from '@potluck/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { invalidateMoney, moneyErrorMessage } from './money-data'

/**
 * Soft deletes an expense right away (it disappears from the list optimistically) and offers
 * Undo in the toast, which restores it.
 */
export function useDeleteExpense() {
  const queryClient = useQueryClient()

  return useCallback(
    async (expense: Pick<ExpenseWithSplits, 'id' | 'group_id' | 'description'>) => {
      const listKey = moneyKeys.expenses(expense.group_id)
      const previous = queryClient.getQueryData<ExpenseWithSplits[]>(listKey)
      queryClient.setQueryData<ExpenseWithSplits[]>(listKey, (rows) =>
        rows?.filter((row) => row.id !== expense.id),
      )
      const refresh = () => invalidateMoney(queryClient, expense.group_id, expense.id)
      try {
        await deleteExpense(supabase, expense.id)
      } catch (error) {
        if (previous) queryClient.setQueryData(listKey, previous)
        toast.error(moneyErrorMessage(error))
        return false
      }
      refresh()
      toast(t('expenses.deleted'), {
        action: {
          label: t('common.undo'),
          onClick: () => {
            restoreExpense(supabase, expense.id)
              .then(() => {
                toast.success(t('expenses.restored'))
                refresh()
              })
              .catch((error: unknown) => toast.error(moneyErrorMessage(error)))
          },
        },
        duration: 8000,
      })
      return true
    },
    [queryClient],
  )
}
