import { createFileRoute } from '@tanstack/react-router'
import { FriendsPage } from '@/features/friends/friends-page'

export const Route = createFileRoute('/_app/friends/')({
  component: FriendsPage,
})
