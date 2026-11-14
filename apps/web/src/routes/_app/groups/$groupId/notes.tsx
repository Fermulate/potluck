import { createFileRoute } from '@tanstack/react-router'
import { GroupNotesPage } from '@/features/groups/notes-page'

export const Route = createFileRoute('/_app/groups/$groupId/notes')({
  component: NotesRoute,
})

function NotesRoute() {
  const { groupId } = Route.useParams()
  return <GroupNotesPage groupId={groupId} />
}
