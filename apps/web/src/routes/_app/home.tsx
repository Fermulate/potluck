import { createFileRoute } from '@tanstack/react-router'
import { HomeDashboard } from '@/features/dashboard/home-dashboard'
import { prefetch } from '@/lib/prefetch'

export const Route = createFileRoute('/_app/home')({
  loader: ({ context }) => prefetch.home(context.queryClient, context.session.user.id),
  component: HomeDashboard,
})
