import { createFileRoute, redirect } from '@tanstack/react-router'
import { LandingPage } from '@/features/shell/landing-page'
import { getSession } from '@/lib/auth'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    if (await getSession()) throw redirect({ to: '/home' })
  },
  component: LandingPage,
})
