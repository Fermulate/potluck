import { createFileRoute } from '@tanstack/react-router'
import { DeletedScreen } from '@/features/insights/deleted-screen'

export const Route = createFileRoute('/_app/groups/$groupId/deleted')({
  component: DeletedRoute,
})

function DeletedRoute() {
  const { groupId } = Route.useParams()
  return <DeletedScreen groupId={groupId} />
}
