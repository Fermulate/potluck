import { deletedGroupsQueryOptions, groupKeys, restoreGroup, type DeletedGroup } from '@potluck/api'
import { daysLeftToRestore, firstName } from '@potluck/core'
import { t } from '@potluck/i18n'
import { Button, cn, EmptyState, Skeleton, toast } from '@potluck/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArchiveRestore, ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import { usePeople } from '@/features/expenses/money-data'
import { Help } from '@/features/help/help'
import { useUserId } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { GroupTile } from './group-bits'

/** Brings a deleted group back for everyone and opens it. */
function useRestore(group: Pick<DeletedGroup, 'id' | 'name'>) {
  const me = useUserId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => restoreGroup(supabase, group.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: groupKeys.all })
      toast.success(t('groups.deleted.restored', { group: group.name }))
      await navigate({ to: '/groups/$groupId', params: { groupId: group.id } })
    },
    onError: (error) => {
      toast.error(errorMessage(error))
      void queryClient.invalidateQueries({ queryKey: groupKeys.deleted(me) })
    },
  })
}

/** "12 days left, deleted by Ben": how long is left, and who did it. */
function DeletedLine({ group }: { group: DeletedGroup }) {
  const me = useUserId()
  const people = usePeople()
  const left = daysLeftToRestore(group.deleted_at)
  const by =
    group.deleted_by === me
      ? t('groups.deleted.byYou')
      : t('groups.deleted.by', {
          name: firstName(
            people.get(group.deleted_by ?? '')?.display_name ?? t('activity.someone'),
          ),
        })
  return (
    <>
      <span className={cn(left <= 3 && 'font-semibold text-tomato-ink')}>
        {left <= 1 ? t('groups.deleted.lastDay') : t('groups.deleted.daysLeft', { count: left })}
      </span>
      {', '}
      {by}
    </>
  )
}

function DeletedRow({ group }: { group: DeletedGroup }) {
  const restore = useRestore(group)
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-card border border-dashed border-line-strong bg-card/60 p-3 sm:p-4">
      <GroupTile emoji={group.emoji} color={group.color} size="sm" className="grayscale-[0.6]" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{group.name}</p>
        <p className="truncate text-xs text-mute">
          <DeletedLine group={group} />
        </p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        leadingIcon={<ArchiveRestore />}
        loading={restore.isPending}
        aria-label={t('groups.deleted.restoreLabel', { group: group.name })}
        onClick={() => restore.mutate()}
      >
        {t('groups.deleted.restore')}
      </Button>
    </li>
  )
}

/**
 * Groups deleted in the last 30 days, folded away under the group list. Anyone who was in one
 * can bring it back; the nightly purge removes it after that.
 */
export function RecentlyDeleted() {
  const me = useUserId()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const { data } = useQuery(deletedGroupsQueryOptions(supabase, me))
  const groups = data ?? []
  if (groups.length === 0) return null
  return (
    <section aria-labelledby={`${listId}-title`} className="mt-10 min-w-0">
      <div className="flex items-center gap-2">
        <h2 id={`${listId}-title`}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 rounded-pill text-sm font-semibold text-mute hover:text-ink"
          >
            {open ? t('groups.deleted.hide') : t('groups.deleted.show', { count: groups.length })}
            <ChevronDown
              aria-hidden
              className={cn('size-4 transition-transform', open && 'rotate-180')}
            />
          </button>
        </h2>
        <Help topic="restoreGroup" />
      </div>
      {open && (
        <div id={listId} className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3">
          <p className="max-w-prose text-sm text-mute">{t('groups.deleted.hint')}</p>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
            {groups.map((g) => (
              <DeletedRow key={g.id} group={g} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function DeletedNotice({ group }: { group: DeletedGroup }) {
  const restore = useRestore(group)
  return (
    <EmptyState
      illustration={
        <GroupTile emoji={group.emoji} color={group.color} size="xl" className="grayscale-[0.6]" />
      }
      as="h1"
      title={t('groups.deleted.pageTitle', { group: group.name })}
      description={
        <>
          <span className="block">
            <DeletedLine group={group} />
          </span>
          <span className="mt-1 block">{t('groups.deleted.pageBody')}</span>
        </>
      }
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            leadingIcon={<ArchiveRestore />}
            loading={restore.isPending}
            onClick={() => restore.mutate()}
          >
            {t('groups.deleted.restoreLabel', { group: group.name })}
          </Button>
          <Button asChild variant="secondary">
            <Link to="/groups">{t('groups.header.back')}</Link>
          </Button>
        </div>
      }
    />
  )
}

/**
 * What a group's address shows when the group is not on the viewer's list: the deleted group
 * with Restore, when it is one of theirs waiting out its 30 days, otherwise "not found".
 */
export function MissingGroup({ groupId }: { groupId: string }) {
  const me = useUserId()
  const deleted = useQuery(deletedGroupsQueryOptions(supabase, me))
  const group = deleted.data?.find((g) => g.id === groupId)
  return (
    <div className="mx-auto max-w-xl px-4 pt-10">
      {deleted.isPending ? (
        <Skeleton className="mx-auto h-48 w-full max-w-sm" />
      ) : group ? (
        <DeletedNotice group={group} />
      ) : (
        <EmptyState
          illustration="🧭"
          title={t('errors.groupNotFound')}
          action={
            <Button asChild variant="secondary">
              <Link to="/groups">{t('groups.header.back')}</Link>
            </Button>
          }
        />
      )}
    </div>
  )
}
