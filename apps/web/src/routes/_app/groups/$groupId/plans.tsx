import { createFileRoute } from '@tanstack/react-router'
import { GroupPlansPage } from '@/features/plans/group-plans-page'

export const Route = createFileRoute('/_app/groups/$groupId/plans')({
  component: GroupPlansRoute,
})

function GroupPlansRoute() {
  const { groupId } = Route.useParams()
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 lg:px-8 lg:pb-12">
      <GroupPlansPage key={groupId} groupId={groupId} />
    </div>
  )
}
