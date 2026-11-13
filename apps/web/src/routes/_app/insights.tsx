import { createFileRoute } from '@tanstack/react-router'
import { SpendingScreen } from '@/features/insights/spending-screen'
import { prefetch } from '@/lib/prefetch'

export const Route = createFileRoute('/_app/insights')({
  loader: ({ context }) => prefetch.spending(context.queryClient),
  component: SpendingScreen,
})
