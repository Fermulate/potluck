import { createFileRoute } from '@tanstack/react-router'
import { ImportScreen } from '@/features/export-import/import-screen'

export const Route = createFileRoute('/_app/groups/$groupId/import')({
  component: ImportRoute,
})

function ImportRoute() {
  const { groupId } = Route.useParams()
  return <ImportScreen groupId={groupId} />
}
