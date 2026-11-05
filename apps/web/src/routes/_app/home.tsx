import { createFileRoute } from '@tanstack/react-router'
import { HomeDashboard } from '@/features/dashboard/home-dashboard'

export const Route = createFileRoute('/_app/home')({
  component: HomeDashboard,
})
