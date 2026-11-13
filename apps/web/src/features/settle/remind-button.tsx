import { moneyErrorCode, paymentKeys, paymentQueries, remindDebt } from '@potluck/api'
import { dayKey } from '@potluck/core'
import { t } from '@potluck/i18n'
import { Button, toast } from '@potluck/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Check } from 'lucide-react'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { moneyErrorMessage } from '@/features/expenses/money-data'

/**
 * "Remind" on a debt someone owes you: sends them a notification (in-app and push). The server
 * allows one per day per group and pair; a second press says it was already sent.
 */
export function RemindButton({
  groupId,
  userId,
  name,
}: {
  groupId: string
  userId: string
  /** First name, for the labels. */
  name: string
}) {
  const me = useUserId()
  const queryClient = useQueryClient()
  // The server counts reminders per UTC day.
  const day = dayKey(new Date(), 'UTC')
  const sent = useQuery(paymentQueries.reminders(supabase, groupId, me, day))
  const reminded = !!sent.data?.some((r) => r.to_user === userId)

  const remind = useMutation({
    mutationFn: () => remindDebt(supabase, groupId, userId),
    onSuccess: () => toast.success(t('balances.remindSent', { name })),
    onError: (error) => {
      if (moneyErrorCode(error) === 'already_reminded') {
        toast(t('balances.alreadyReminded', { name }))
      } else {
        toast.error(moneyErrorMessage(error))
      }
    },
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: paymentKeys.reminders(groupId) }),
  })

  return (
    <Button
      size="sm"
      variant={reminded ? 'ghost' : 'secondary'}
      leadingIcon={reminded ? <Check /> : <BellRing />}
      aria-label={t('balances.remindLabel', { name })}
      loading={remind.isPending}
      onClick={() => remind.mutate()}
    >
      {reminded ? t('balances.reminded') : t('balances.remind')}
    </Button>
  )
}
