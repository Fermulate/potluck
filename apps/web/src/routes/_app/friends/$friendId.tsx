import { createFileRoute } from '@tanstack/react-router'
import { FriendPage } from '@/features/friends/friend-page'

export const Route = createFileRoute('/_app/friends/$friendId')({
  component: FriendRoute,
})

function FriendRoute() {
  const { friendId } = Route.useParams()
  return <FriendPage key={friendId} friendId={friendId} />
}
