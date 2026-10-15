import { createFileRoute } from '@tanstack/react-router'
import { ExpensesTab } from '@/features/expenses/expenses-tab'

export const Route = createFileRoute('/_app/groups/$groupId/')({
  component: GroupExpenses,
})

function GroupExpenses() {
  const { groupId } = Route.useParams()
  return <ExpensesTab groupId={groupId} />
}
