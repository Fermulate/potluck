import { createFileRoute } from '@tanstack/react-router'
import { GroupLayout } from '@/features/groups/group-layout'

export const Route = createFileRoute('/_app/groups/$groupId')({
  component: GroupRoute,
})

function GroupRoute() {
  const { groupId } = Route.useParams()
  return <GroupLayout groupId={groupId} />
}
