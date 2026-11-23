import { createFileRoute } from '@tanstack/react-router'
import { CreatePollPage } from '@/features/quick-polls/create-poll-page'

// Public: anyone makes a quick poll, signed in or not.
export const Route = createFileRoute('/poll')({
  component: CreatePollPage,
})
