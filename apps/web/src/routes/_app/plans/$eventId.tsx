import { createFileRoute } from '@tanstack/react-router'
import { EventPage } from '@/features/plans/event-page'
import { prefetch } from '@/lib/prefetch'

export const Route = createFileRoute('/_app/plans/$eventId')({
  loader: ({ context, params }) => prefetch.event(context.queryClient, params.eventId),
  component: EventRoute,
})

function EventRoute() {
  const { eventId } = Route.useParams()
  return <EventPage key={eventId} eventId={eventId} />
}
