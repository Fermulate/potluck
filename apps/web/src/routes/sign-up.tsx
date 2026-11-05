import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { SignUpPage } from '@/features/auth/sign-up-page'
import { useJoinNotice } from '@/features/invites/join-notice'
import { getSession, safeRedirect } from '@/lib/auth'

export const Route = createFileRoute('/sign-up')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async ({ search }) => {
    if (await getSession()) throw redirect({ href: safeRedirect(search.redirect) })
  },
  component: SignUpRoute,
})

function SignUpRoute() {
  const { redirect } = Route.useSearch()
  const notice = useJoinNotice(redirect)
  return <SignUpPage redirect={redirect} notice={notice} />
}
