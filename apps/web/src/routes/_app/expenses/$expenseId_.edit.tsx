import { moneyQueries } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Skeleton } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ExpenseForm } from '@/features/expenses/form/expense-form'
import { MoneyPageShell } from '@/features/expenses/money-page-shell'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/expenses/$expenseId_/edit')({
  component: EditExpense,
})

function EditExpense() {
  const { expenseId } = Route.useParams()
  const navigate = useNavigate()
  const expense = useQuery(moneyQueries.expense(supabase, expenseId))
  const back = () => void navigate({ to: '/expenses/$expenseId', params: { expenseId } })

  if (!expense.data) {
    return (
      <MoneyPageShell title={t('expenses.form.editTitle')} onClose={back} width="lg">
        <div aria-busy="true" className="flex flex-col items-center gap-6 p-6">
          <Skeleton className="h-20 w-56" />
          <Skeleton className="h-12 w-full max-w-md" />
        </div>
      </MoneyPageShell>
    )
  }

  return (
    <ExpenseForm
      key={expense.data.updated_at}
      mode="edit"
      expense={expense.data}
      onClose={back}
      onDone={back}
    />
  )
}
