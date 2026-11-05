import { createFileRoute } from '@tanstack/react-router'
import { GroupLayout } from '@/features/groups/group-layout'
import { prefetch } from '@/lib/prefetch'

export const Route = createFileRoute('/_app/groups/$groupId')({
  loader: ({ context, params }) =>
    prefetch.group(context.queryClient, params.groupId, context.session.user.id),
  component: GroupRoute,
})

function GroupRoute() {
  const { groupId } = Route.useParams()
  return <GroupLayout groupId={groupId} />
}
