import { createFileRoute } from '@tanstack/react-router'
import { EventPage } from '@/features/plans/event-page'

export const Route = createFileRoute('/_app/plans/$eventId')({
  component: EventRoute,
})

function EventRoute() {
  const { eventId } = Route.useParams()
  return <EventPage key={eventId} eventId={eventId} />
}
