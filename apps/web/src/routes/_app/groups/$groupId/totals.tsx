import { createFileRoute } from '@tanstack/react-router'
import { GroupTotals } from '@/features/insights/group-totals'
import { prefetch } from '@/lib/prefetch'

export const Route = createFileRoute('/_app/groups/$groupId/totals')({
  loader: ({ context, params }) => prefetch.groupTotals(context.queryClient, params.groupId),
  component: GroupTotalsRoute,
})

function GroupTotalsRoute() {
  const { groupId } = Route.useParams()
  return <GroupTotals groupId={groupId} />
}
