import { createFileRoute } from '@tanstack/react-router'
import { UnsubscribePage } from '@/features/notifications/unsubscribe-page'
import { getSession } from '@/lib/auth'
import { stringParam } from '@/lib/search'

export const Route = createFileRoute('/unsubscribe')({
  validateSearch: stringParam('token'),
  beforeLoad: async () => {
    // Settle the stored session so the settings link points at the right place.
    await getSession()
  },
  component: UnsubscribeRoute,
})

function UnsubscribeRoute() {
  const { token } = Route.useSearch()
  return <UnsubscribePage token={token} />
}
