import { createFileRoute } from '@tanstack/react-router'
import { BalancesTab } from '@/features/balances/balances-tab'
import { prefetch } from '@/lib/prefetch'

export const Route = createFileRoute('/_app/groups/$groupId/balances')({
  loader: ({ context, params }) => prefetch.balances(context.queryClient, params.groupId),
  component: GroupBalances,
})

function GroupBalances() {
  const { groupId } = Route.useParams()
  return <BalancesTab groupId={groupId} />
}
