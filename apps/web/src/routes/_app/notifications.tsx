import { createFileRoute } from '@tanstack/react-router'
import { NotificationsPage } from '@/features/notifications/notifications-page'
import { prefetch } from '@/lib/prefetch'

export const Route = createFileRoute('/_app/notifications')({
  loader: ({ context }) => prefetch.notifications(context.queryClient, context.session.user.id),
  component: NotificationsPage,
})
