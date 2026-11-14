import { groupKeys, myBlocksQueryOptions, peopleKeys, unblockUser } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Avatar, Button, Card, Skeleton, toast } from '@potluck/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useUserId } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { avatarSrc } from '@/lib/queries'
import { supabase } from '@/lib/supabase'

/** Blocked people on the Me page, each with Unblock. Mounted on its own line in `me-page.tsx`. */
export function BlockedPeopleSection() {
  const userId = useUserId()
  const queryClient = useQueryClient()
  const blocks = useQuery(myBlocksQueryOptions(supabase, userId))
  const [busy, setBusy] = useState<string | null>(null)

  async function unblock(id: string, name: string) {
    setBusy(id)
    try {
      await unblockUser(supabase, userId, id)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: peopleKeys.blocks(userId) }),
        queryClient.invalidateQueries({ queryKey: groupKeys.friends(userId) }),
        queryClient.invalidateQueries({ queryKey: peopleKeys.canSplit(id) }),
      ])
      toast.success(t('people.blocked.unblocked', { name }))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="me-blocked" className="grid gap-3">
      <h2 id="me-blocked" className="text-sm font-bold text-mute">
        {t('settings.privacy.blocked')}
      </h2>
      <Card padding="roomy" className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {blocks.isPending ? (
          <Skeleton className="h-12" />
        ) : !blocks.data?.length ? (
          <p className="text-sm text-mute">{t('settings.privacy.noneBlocked')}</p>
        ) : (
          <ul className="grid gap-1">
            {blocks.data.map((person) => (
              <li key={person.user_id} className="flex items-center gap-3 py-1.5">
                <Avatar
                  name={person.display_name}
                  seed={person.user_id}
                  src={avatarSrc(person.avatar_path)}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate font-semibold">{person.display_name}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === person.user_id}
                  aria-label={t('people.blocked.unblockName', { name: person.display_name })}
                  onClick={() => void unblock(person.user_id, person.display_name)}
                >
                  {t('settings.privacy.unblock')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-mute">{t('people.blocked.hint')}</p>
      </Card>
    </section>
  )
}
