import { createFileRoute } from '@tanstack/react-router'
import { JoinPage } from '@/features/invites/join-page'
import { getSession } from '@/lib/auth'

export const Route = createFileRoute('/join/$code')({
  beforeLoad: async () => {
    // Settle the stored session first so the page knows whether to offer join or sign up.
    await getSession()
  },
  component: JoinRoute,
})

function JoinRoute() {
  const { code } = Route.useParams()
  return <JoinPage code={code} />
}
