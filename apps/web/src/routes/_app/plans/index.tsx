import { createFileRoute } from '@tanstack/react-router'
import { PlansPage } from '@/features/plans/plans-page'

export const Route = createFileRoute('/_app/plans/')({
  component: PlansPage,
})
