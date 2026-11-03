import { createFileRoute } from '@tanstack/react-router'
import { ActivityFeed } from '@/features/activity/activity-feed'
import { prefetch } from '@/lib/prefetch'

export const Route = createFileRoute('/_app/activity')({
  loader: ({ context }) => prefetch.activity(context.queryClient),
  component: ActivityFeed,
})
