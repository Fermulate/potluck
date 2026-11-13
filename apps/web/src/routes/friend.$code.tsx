import { createFileRoute } from '@tanstack/react-router'
import { FriendJoinPage } from '@/features/friends/friend-join-page'
import { getSession } from '@/lib/auth'

export const Route = createFileRoute('/friend/$code')({
  beforeLoad: async () => {
    // Settle the stored session first so the page knows whether to offer accept or sign up.
    await getSession()
  },
  component: FriendJoinRoute,
})

function FriendJoinRoute() {
  const { code } = Route.useParams()
  return <FriendJoinPage code={code} />
}
