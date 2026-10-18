import { createFileRoute } from '@tanstack/react-router'
import { MembersPage } from '@/features/groups/members-page'

export const Route = createFileRoute('/_app/groups/$groupId/members')({
  component: MembersRoute,
})

function MembersRoute() {
  const { groupId } = Route.useParams()
  return <MembersPage groupId={groupId} />
}
