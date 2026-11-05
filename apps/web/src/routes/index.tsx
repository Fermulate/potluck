import { createFileRoute, redirect } from '@tanstack/react-router'
import { HomePage } from '@/features/home/home-page'
import { getSession } from '@/lib/auth'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    if (await getSession()) throw redirect({ to: '/home' })
  },
  component: HomePage,
})
