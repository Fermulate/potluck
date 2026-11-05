import { formatMoney, t } from '@potluck/i18n'
import { Card } from '@potluck/ui'
import { useMemo } from 'react'
import { ExpenseRow } from '@/features/expenses/expense-row'
import { useGroupExpenses, useNameOf } from '@/features/expenses/money-data'
import { useUserId } from '@/lib/auth'

/**
 * Expenses filed under this plan, so the bill you just split from here shows up here.
 * Reads the group's expense list (usually already cached from the group page).
 */
export function PlanExpenses({ groupId, eventId }: { groupId: string; eventId: string }) {
  const me = useUserId()
  const nameOf = useNameOf()
  const { data } = useGroupExpenses(groupId)
  const linked = useMemo(() => (data ?? []).filter((e) => e.event_id === eventId), [data, eventId])
  if (!me || linked.length === 0) return null

  // Totals only make sense in one currency; mixed plans just list the rows.
  const currency = linked[0]!.currency
  const sameCurrency = linked.every((e) => e.currency === currency)
  const total = linked.reduce((sum, e) => sum + e.amount_cents, 0)

  return (
    <section aria-labelledby={`plan-expenses-${eventId}`} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 id={`plan-expenses-${eventId}`} className="text-xl font-bold tracking-tight">
          {t('events.spent.title')}
        </h2>
        {sameCurrency && (
          <p className="tabular text-sm text-mute">
            {t('events.spent.total', { amount: formatMoney(total, currency) })}
          </p>
        )}
      </div>
      <Card padding="none" className="overflow-hidden">
        <ul className="divide-y divide-line">
          {linked.map((expense) => (
            <li key={expense.id}>
              <ExpenseRow expense={expense} viewerId={me} payerName={nameOf(expense.paid_by)} />
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}
