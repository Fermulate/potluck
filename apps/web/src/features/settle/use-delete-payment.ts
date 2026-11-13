import {
  deleteSettlement,
  moneyKeys,
  paymentKeys,
  restoreSettlement,
  type Settlement,
} from '@potluck/api'
import { t } from '@potluck/i18n'
import { toast } from '@potluck/ui'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { invalidateMoney, moneyErrorMessage } from '@/features/expenses/money-data'

function refreshPayment(queryClient: QueryClient, payment: Pick<Settlement, 'id' | 'group_id'>) {
  invalidateMoney(queryClient, payment.group_id)
  void queryClient.invalidateQueries({ queryKey: paymentKeys.settlement(payment.id) })
  void queryClient.invalidateQueries({ queryKey: paymentKeys.friendBalances() })
}

/** Restores a deleted payment and says so. */
export function useRestorePayment() {
  const queryClient = useQueryClient()
  return useCallback(
    async (payment: Pick<Settlement, 'id' | 'group_id'>) => {
      try {
        await restoreSettlement(supabase, payment.id)
      } catch (error) {
        toast.error(moneyErrorMessage(error))
        return false
      }
      toast.success(t('settle.restored'))
      refreshPayment(queryClient, payment)
      return true
    },
    [queryClient],
  )
}

/**
 * Soft deletes a payment right away (it leaves the list optimistically) and offers Undo in the
 * toast, which restores it.
 */
export function useDeletePayment() {
  const queryClient = useQueryClient()
  const restore = useRestorePayment()

  return useCallback(
    async (payment: Pick<Settlement, 'id' | 'group_id'>) => {
      const listKey = moneyKeys.settlements(payment.group_id)
      const previous = queryClient.getQueryData<Settlement[]>(listKey)
      queryClient.setQueryData<Settlement[]>(listKey, (rows) =>
        rows?.filter((row) => row.id !== payment.id),
      )
      try {
        await deleteSettlement(supabase, payment.id)
      } catch (error) {
        if (previous) queryClient.setQueryData(listKey, previous)
        toast.error(moneyErrorMessage(error))
        return false
      }
      refreshPayment(queryClient, payment)
      toast(t('settle.deleted'), {
        action: { label: t('settle.undo'), onClick: () => void restore(payment) },
        duration: 8000,
      })
      return true
    },
    [queryClient, restore],
  )
}
