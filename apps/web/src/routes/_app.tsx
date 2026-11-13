import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppLayout } from '@/features/shell/app-layout'
import { getSession, needsOnboarding, needsSecondFactor } from '@/lib/auth'
import { prefetch } from '@/lib/prefetch'

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    const session = await getSession()
    if (!session) throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    if (needsSecondFactor(session)) {
      throw redirect({ to: '/two-factor', search: { redirect: location.href } })
    }
    if (needsOnboarding(session)) {
      throw redirect({ to: '/welcome', search: { redirect: location.href } })
    }
    return { session }
  },
  loader: ({ context }) => prefetch.shell(context.queryClient, context.session.user.id),
  component: AppLayout,
})
