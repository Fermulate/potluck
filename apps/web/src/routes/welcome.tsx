import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { OnboardingPage } from '@/features/onboarding/onboarding-page'
import { getSession, safeRedirect } from '@/lib/auth'

export const Route = createFileRoute('/welcome')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async ({ location }) => {
    const session = await getSession()
    if (!session) throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    return { userId: session.user.id }
  },
  component: WelcomeRoute,
})

function WelcomeRoute() {
  const { userId } = Route.useRouteContext()
  const { redirect } = Route.useSearch()
  return <OnboardingPage userId={userId} redirect={safeRedirect(redirect)} />
}
