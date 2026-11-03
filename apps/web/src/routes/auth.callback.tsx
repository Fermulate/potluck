import { createFileRoute } from '@tanstack/react-router'
import { AuthCallbackPage } from '@/features/auth/callback-page'
import { redirectSearch } from '@/lib/search'

export const Route = createFileRoute('/auth/callback')({
  validateSearch: redirectSearch,
  component: AuthCallbackRoute,
})

function AuthCallbackRoute() {
  const { redirect } = Route.useSearch()
  return <AuthCallbackPage redirect={redirect} />
}
