import { moneyErrorCode, paymentKeys, paymentQueries, remindDebt } from '@potluck/api'
import { dayKey } from '@potluck/core'
import { t } from '@potluck/i18n'
import { Button, Field, Sheet, SheetContent, TextArea, toast } from '@potluck/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Check } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { moneyErrorMessage } from '@/features/expenses/money-data'

/**
 * "Remind" on a debt someone owes you: sends them a notification (in-app and push), with an
 * optional note. The server allows one per day per group and pair; pressing it again that day
 * says it was already sent.
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
  const formId = useId()
  const queryClient = useQueryClient()
  // The server counts reminders per UTC day.
  const day = dayKey(new Date(), 'UTC')
  const sent = useQuery(paymentQueries.reminders(supabase, groupId, me, day))
  const reminded = !!sent.data?.some((r) => r.to_user === userId)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')

  const remind = useMutation({
    mutationFn: () => remindDebt(supabase, groupId, userId, note),
    onSuccess: () => {
      toast.success(t('balances.remindSent', { name }))
      setOpen(false)
      setNote('')
    },
    onError: (error) => {
      if (moneyErrorCode(error) === 'already_reminded') {
        setOpen(false)
        toast(t('balances.alreadyReminded', { name }))
      } else {
        toast.error(moneyErrorMessage(error))
      }
    },
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: paymentKeys.reminders(groupId) }),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    remind.mutate()
  }

  return (
    <>
      <Button
        size="sm"
        variant={reminded ? 'ghost' : 'secondary'}
        leadingIcon={reminded ? <Check /> : <BellRing />}
        aria-label={t('balances.remindLabel', { name })}
        onClick={() => (reminded ? toast(t('balances.alreadyReminded', { name })) : setOpen(true))}
      >
        {reminded ? t('balances.reminded') : t('balances.remind')}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          title={t('balances.remindTitle', { name })}
          description={t('balances.remindBody', { name })}
          closeLabel={t('common.close')}
          size="sm"
          footer={
            <Button
              type="submit"
              form={formId}
              block
              size="lg"
              leadingIcon={<BellRing />}
              loading={remind.isPending}
            >
              {t('balances.remindSend')}
            </Button>
          }
        >
          <form id={formId} onSubmit={submit} noValidate>
            <Field label={t('balances.remindNote')} hint={t('common.optional')}>
              <TextArea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('balances.remindNotePlaceholder')}
                maxLength={280}
                rows={2}
              />
            </Field>
          </form>
        </SheetContent>
      </Sheet>
    </>
  )
}
