import { createFileRoute } from '@tanstack/react-router'
import { ActivityFeed } from '@/features/activity/activity-feed'
import { validateActivitySearch } from '@/features/insights/search-params'
import { prefetch } from '@/lib/prefetch'

export const Route = createFileRoute('/_app/activity')({
  validateSearch: validateActivitySearch,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => prefetch.activity(context.queryClient, deps),
  component: ActivityRoute,
})

function ActivityRoute() {
  const { groupId, person } = Route.useSearch()
  return <ActivityFeed groupId={groupId} person={person} />
}
