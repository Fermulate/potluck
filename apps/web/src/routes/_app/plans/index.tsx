import { createFileRoute } from '@tanstack/react-router'
import { PlansPage } from '@/features/plans/plans-page'
import { prefetch } from '@/lib/prefetch'

export const Route = createFileRoute('/_app/plans/')({
  loader: ({ context }) => prefetch.plans(context.queryClient),
  component: PlansPage,
})
