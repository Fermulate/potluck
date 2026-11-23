import { createFileRoute } from '@tanstack/react-router'
import { PollPage } from '@/features/quick-polls/poll-page'

// Public: anyone with the link answers a quick poll. No session wait, nothing else to load.
export const Route = createFileRoute('/p/$code')({
  component: QuickPollRoute,
})

function QuickPollRoute() {
  const { code } = Route.useParams()
  return <PollPage code={code} />
}
