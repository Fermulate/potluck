import { createFileRoute } from '@tanstack/react-router'
import { CreatePlanPage } from '@/features/plans/create-plan-page'

interface PlanSearch {
  groupId?: string
}

export const Route = createFileRoute('/_app/new/plan')({
  validateSearch: (search: Record<string, unknown>): PlanSearch =>
    typeof search.groupId === 'string' && search.groupId ? { groupId: search.groupId } : {},
  component: NewPlanRoute,
})

function NewPlanRoute() {
  const { groupId } = Route.useSearch()
  return <CreatePlanPage groupId={groupId} />
}
