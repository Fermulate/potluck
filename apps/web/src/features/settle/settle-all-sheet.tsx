import { avatarSrc } from '@/lib/queries'
import { paymentKeys, settleAll, type MoneyGroup, type MoneyPerson } from '@potluck/api'
import { type Transfer } from '@potluck/core'
import { formatMoney, t } from '@potluck/i18n'
import { Avatar, Button, Sheet, SheetContent, toast } from '@potluck/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CheckCheck } from 'lucide-react'
import { Help } from '@/features/help/help'
import { invalidateMoney, moneyErrorMessage, useNameOf } from '@/features/expenses/money-data'
import { supabase } from '@/lib/supabase'

/**
 * "Settle everything": lists the payments that square the viewer with everyone in the group
 * (the same set `settle_all` records) and records them in one go.
 */
export function SettleAllSheet({
  open,
  onOpenChange,
  group,
  payments,
  personOf,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: MoneyGroup
  payments: Transfer[]
  personOf: (id: string) => MoneyPerson | undefined
}) {
  const queryClient = useQueryClient()
  const nameOf = useNameOf()
  const count = payments.length

  const record = useMutation({
    mutationFn: () => settleAll(supabase, group.id),
    onSuccess: (rows) => {
      invalidateMoney(queryClient, group.id)
      void queryClient.invalidateQueries({ queryKey: paymentKeys.friendBalances() })
      toast.success(
        rows.length > 0
          ? t('settle.settleAllDone', { count: rows.length })
          : t('settle.nothingToSettle'),
      )
      onOpenChange(false)
    },
    onError: (error) => toast.error(moneyErrorMessage(error)),
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={t('settle.settleAllTitle')}
        description={t('settle.settleAllBody')}
        closeLabel={t('common.close')}
        footer={
          <Button
            block
            size="lg"
            leadingIcon={<CheckCheck />}
            loading={record.isPending}
            disabled={count === 0}
            onClick={() => record.mutate()}
          >
            {t('settle.settleAllRecord', { count })}
          </Button>
        }
      >
        <ul className="divide-y divide-line">
          {payments.map((p) => {
            const from = personOf(p.fromUser)
            const to = personOf(p.toUser)
            return (
              <li key={`${p.fromUser}-${p.toUser}`} className="flex items-center gap-3 py-3">
                <span aria-hidden className="flex shrink-0 items-center">
                  <Avatar
                    name={from?.display_name ?? '?'}
                    seed={p.fromUser}
                    src={avatarSrc(from?.avatar_path)}
                    size="sm"
                  />
                  <ArrowRight className="mx-0.5 size-3.5 text-mute" strokeWidth={2.5} />
                  <Avatar
                    name={to?.display_name ?? '?'}
                    seed={p.toUser}
                    src={avatarSrc(to?.avatar_path)}
                    size="sm"
                  />
                </span>
                <span className="min-w-0 flex-1 text-[0.9375rem] font-medium">
                  {t('settle.paid', {
                    from: nameOf(p.fromUser),
                    to: nameOf(p.toUser, { lower: true }),
                    amount: formatMoney(p.amountCents, group.currency),
                  })}
                </span>
              </li>
            )
          })}
        </ul>
        <div className="pt-2">
          <Help topic="settleEverything" showLabel />
        </div>
      </SheetContent>
    </Sheet>
  )
}
