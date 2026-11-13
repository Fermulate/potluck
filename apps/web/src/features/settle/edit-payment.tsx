import { paymentQueries } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Skeleton } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useDebts } from '@/features/balances/use-debts'
import { MoneyPageShell } from '@/features/expenses/money-page-shell'
import { useMoneyGroup } from '@/features/expenses/money-data'
import { PaymentForm } from './settle-flow'

/** The settle up form, filled in from a recorded payment. */
export function EditPayment({
  paymentId,
  onClose,
  onDone,
}: {
  paymentId: string
  onClose: () => void
  onDone: () => void
}) {
  const payment = useQuery(paymentQueries.settlement(supabase, paymentId))
  const group = useMoneyGroup(payment.data?.group_id)
  const debts = useDebts(payment.data?.group_id ?? '', group.data)

  if (!payment.data || !group.data || !debts) {
    return (
      <MoneyPageShell title={t('settle.editTitle')} onClose={onClose}>
        <div aria-busy="true" className="flex flex-col items-center gap-6 p-6">
          <Skeleton className="h-20 w-56" />
          <Skeleton className="h-12 w-full max-w-md" />
        </div>
      </MoneyPageShell>
    )
  }

  const p = payment.data
  return (
    <PaymentForm
      key={p.id}
      group={group.data}
      debts={debts}
      initialFrom={p.from_user}
      initialTo={p.to_user}
      initialAmount={p.amount_cents}
      editing={p}
      onClose={onClose}
      onDone={onDone}
    />
  )
}
