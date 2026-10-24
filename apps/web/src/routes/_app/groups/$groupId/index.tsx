import { createFileRoute } from '@tanstack/react-router'
import { ExpensesTab } from '@/features/expenses/expenses-tab'
import { prefetch } from '@/lib/prefetch'

export const Route = createFileRoute('/_app/groups/$groupId/')({
  loader: ({ context, params }) => prefetch.expenses(context.queryClient, params.groupId),
  component: GroupExpenses,
})

function GroupExpenses() {
  const { groupId } = Route.useParams()
  return <ExpensesTab groupId={groupId} />
}
