import { createFileRoute } from '@tanstack/react-router'
import { RecurringEditScreen } from '@/features/recurring/recurring-edit'

export const Route = createFileRoute('/_app/recurring/$recurringId')({
  component: RecurringRoute,
})

function RecurringRoute() {
  const { recurringId } = Route.useParams()
  return <RecurringEditScreen key={recurringId} recurringId={recurringId} />
}
