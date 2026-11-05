import { createFileRoute } from '@tanstack/react-router'
import { GroupSettingsPage } from '@/features/groups/settings-page'

export const Route = createFileRoute('/_app/groups/$groupId/settings')({
  component: SettingsRoute,
})

function SettingsRoute() {
  const { groupId } = Route.useParams()
  return <GroupSettingsPage groupId={groupId} />
}
