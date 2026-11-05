import { createFileRoute } from '@tanstack/react-router'
import { BalancesTab } from '@/features/balances/balances-tab'

export const Route = createFileRoute('/_app/groups/$groupId/balances')({
  component: GroupBalances,
})

function GroupBalances() {
  const { groupId } = Route.useParams()
  return <BalancesTab groupId={groupId} />
}
