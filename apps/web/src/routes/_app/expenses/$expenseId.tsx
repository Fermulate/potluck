import { createFileRoute } from '@tanstack/react-router'
import { ExpenseDetail } from '@/features/expenses/expense-detail'

export const Route = createFileRoute('/_app/expenses/$expenseId')({
  component: ExpenseRoute,
})

function ExpenseRoute() {
  const { expenseId } = Route.useParams()
  return <ExpenseDetail key={expenseId} expenseId={expenseId} />
}
