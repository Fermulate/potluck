import { createFileRoute } from '@tanstack/react-router'
import { GuestPage } from '@/features/guests/guest-page'

// Public: guests add their times without an account. No session wait, nothing else to load.
export const Route = createFileRoute('/a/$code')({
  component: GuestRoute,
})

function GuestRoute() {
  const { code } = Route.useParams()
  return <GuestPage code={code} />
}
