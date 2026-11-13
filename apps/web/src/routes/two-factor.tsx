import { createFileRoute, redirect } from '@tanstack/react-router'
import { TwoFactorPage } from '@/features/auth/two-factor-page'
import { getSession, needsSecondFactor, safeRedirect } from '@/lib/auth'
import { redirectSearch } from '@/lib/search'

export const Route = createFileRoute('/two-factor')({
  validateSearch: redirectSearch,
  beforeLoad: async ({ search }) => {
    const session = await getSession()
    if (!session) throw redirect({ to: '/sign-in', search: { redirect: search.redirect } })
    if (!needsSecondFactor(session)) throw redirect({ href: safeRedirect(search.redirect) })
  },
  component: TwoFactorRoute,
})

function TwoFactorRoute() {
  const { redirect } = Route.useSearch()
  return <TwoFactorPage redirect={safeRedirect(redirect)} />
}
