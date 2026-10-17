import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { AuthCallbackPage } from '@/features/auth/callback-page'

export const Route = createFileRoute('/auth/callback')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  component: AuthCallbackRoute,
})

function AuthCallbackRoute() {
  const { redirect } = Route.useSearch()
  return <AuthCallbackPage redirect={redirect} />
}
