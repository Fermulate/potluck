import { createFileRoute, redirect } from '@tanstack/react-router'
import { SignInPage } from '@/features/auth/sign-in-page'
import { useJoinNotice } from '@/features/invites/join-notice'
import { getSession, safeRedirect } from '@/lib/auth'
import { redirectSearch } from '@/lib/search'

export const Route = createFileRoute('/sign-in')({
  validateSearch: redirectSearch,
  beforeLoad: async ({ search }) => {
    if (await getSession()) throw redirect({ href: safeRedirect(search.redirect) })
  },
  component: SignInRoute,
})

function SignInRoute() {
  const { redirect } = Route.useSearch()
  const notice = useJoinNotice(redirect)
  return <SignInPage redirect={redirect} notice={notice} />
}
