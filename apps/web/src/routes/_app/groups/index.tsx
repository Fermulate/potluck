import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { GroupsPage } from '@/features/groups/groups-page'
import { prefetch } from '@/lib/prefetch'

export const Route = createFileRoute('/_app/groups/')({
  validateSearch: z.object({ new: z.boolean().optional() }),
  loader: ({ context }) => prefetch.groups(context.queryClient, context.session.user.id),
  component: GroupsRoute,
})

function GroupsRoute() {
  const { new: createOpen } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <GroupsPage
      createOpen={!!createOpen}
      onCreateOpenChange={(open) =>
        void navigate({ search: open ? { new: true } : {}, replace: true })
      }
    />
  )
}
