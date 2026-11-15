import { paymentQueries } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Skeleton } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useDebts } from '@/features/balances/use-debts'
import { MoneyPageShell } from '@/features/expenses/money-page-shell'
import { useMoneyGroup } from '@/features/expenses/money-data'
import { useBlockedInTab } from '@/features/friends/split-note'
import { mayEditPayment } from './payment-rules'
import { PaymentForm } from './settle-flow'

/**
 * The settle up form, filled in from a recorded payment. Someone who may not change it (the
 * rule that hides Edit on the payment's page) is sent back there instead of finding out on Save.
 */
export function EditPayment({
  paymentId,
  onClose,
  onDone,
  onNotAllowed,
}: {
  paymentId: string
  onClose: () => void
  onDone: () => void
  /** Leaves for the payment's page; called once it is known the viewer may not edit it. */
  onNotAllowed: () => void
}) {
  const me = useUserId()
  const payment = useQuery(paymentQueries.settlement(supabase, paymentId))
  const group = useMoneyGroup(payment.data?.group_id)
  const debts = useDebts(payment.data?.group_id ?? '', group.data)
  const blockedInTab = useBlockedInTab(payment.data?.group_id)
  const allowed =
    payment.data && group.data
      ? mayEditPayment(payment.data, {
          viewerId: me,
          role: group.data.members.find((m) => m.id === me)?.role,
          blockedInTab,
          archived: !!group.data.archived_at,
        })
      : undefined

  const leave = useRef(onNotAllowed)
  useEffect(() => {
    leave.current = onNotAllowed
  })
  useEffect(() => {
    if (allowed === false) leave.current()
  }, [allowed])

  if (!payment.data || !group.data || !debts || allowed !== true) {
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
