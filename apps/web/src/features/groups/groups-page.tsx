import type { GroupDetail } from '@potluck/api'
import { t } from '@potluck/i18n'
import {
  AvatarStack,
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
  usePrefersReducedMotion,
} from '@potluck/ui'
import { Link } from '@tanstack/react-router'
import { ChevronDown, Plus, UsersRound } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { errorMessage } from '@/lib/errors'
import { CreateGroupSheet } from './create-group-sheet'
import { GroupTile, ViewerBalance } from './group-bits'
import { groupTransitionName, stackPeople } from './people'
import { useAllGroupsRealtime, useMyGroups } from './use-groups'

function GroupCard({ group, index }: { group: GroupDetail; index: number }) {
  const reduced = usePrefersReducedMotion()
  const people = stackPeople(group.members)
  return (
    <motion.li
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduced
          ? { duration: 0.15 }
          : { type: 'spring', stiffness: 380, damping: 32, delay: index * 0.03 }
      }
    >
      <Link
        to="/groups/$groupId"
        params={{ groupId: group.id }}
        viewTransition
        className="group flex h-full flex-col gap-4 rounded-card border border-line bg-card p-4 transition-[border-color,transform] duration-150 [--avatar-ring:var(--pl-card)] hover:border-ink/25 active:scale-[0.99] sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <GroupTile
            emoji={group.emoji}
            color={group.color}
            size="md"
            className="transition-transform duration-200 group-hover:rotate-[-9deg]"
            style={{ viewTransitionName: groupTransitionName(group.id) }}
          />
          <ViewerBalance cents={group.my_net_cents} currency={group.currency} stacked />
        </div>
        <div className="mt-auto">
          <h3 className="truncate font-display text-[1.75rem] leading-tight">{group.name}</h3>
          <div className="mt-2 flex items-center gap-2">
            <AvatarStack
              people={people}
              max={5}
              size="xs"
              label={t('groups.memberCount', { count: people.length })}
            />
            <span className="text-xs font-medium text-mute">
              {t('groups.memberCount', { count: people.length })}
            </span>
          </div>
        </div>
      </Link>
    </motion.li>
  )
}

function GroupsSkeleton() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} className="flex items-center gap-4 rounded-card border border-line bg-card p-4">
          <Skeleton className="size-14 rounded-[1rem]" />
          <div className="grid flex-1 gap-2">
            <Skeleton shape="line" className="w-2/3" />
            <Skeleton shape="line" className="w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function GroupsPage({
  createOpen,
  onCreateOpenChange,
}: {
  createOpen: boolean
  onCreateOpenChange: (open: boolean) => void
}) {
  const { data, isPending, error, refetch } = useMyGroups()
  const [showArchived, setShowArchived] = useState(false)
  useAllGroupsRealtime()

  const shared = (data ?? []).filter((g) => !g.is_direct)
  const active = shared.filter((g) => !g.archived_at)
  const archived = shared.filter((g) => g.archived_at)

  const newButton = (
    <Button leadingIcon={<Plus />} onClick={() => onCreateOpenChange(true)}>
      {t('groups.new')}
    </Button>
  )

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-32 lg:px-8 lg:pt-10 lg:pb-12">
      <PageHeader
        title={t('groups.title')}
        subtitle={t('groups.subtitle')}
        actions={<div className="hidden sm:block">{newButton}</div>}
      />

      <div className="mt-6 flex flex-wrap gap-2">
        <Button asChild variant="secondary" size="sm">
          <Link to="/friends">
            <UsersRound aria-hidden className="-ml-1 size-4" />
            {t('nav.friends')}
          </Link>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<Plus />}
          className="sm:hidden"
          onClick={() => onCreateOpenChange(true)}
        >
          {t('groups.new')}
        </Button>
      </div>

      <section aria-labelledby="groups-yours" className="mt-6">
        <h2 id="groups-yours" className="sr-only">
          {t('groups.yours')}
        </h2>
        {isPending ? (
          <GroupsSkeleton />
        ) : error ? (
          <EmptyState
            title={t('groups.loadError')}
            description={errorMessage(error)}
            action={
              <Button variant="secondary" onClick={() => void refetch()}>
                {t('common.retry')}
              </Button>
            }
          />
        ) : active.length === 0 ? (
          <EmptyState
            illustration="🍽️"
            title={t('empty.groups.title')}
            description={t('empty.groups.body')}
            action={
              <Button leadingIcon={<Plus />} onClick={() => onCreateOpenChange(true)}>
                {t('empty.groups.action')}
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {active.map((group, i) => (
              <GroupCard key={group.id} group={group} index={i} />
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 && (
        <section aria-labelledby="groups-archived" className="mt-10">
          <h2 id="groups-archived">
            <button
              type="button"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((s) => !s)}
              className="flex items-center gap-2 rounded-pill text-sm font-semibold text-mute hover:text-ink"
            >
              {showArchived
                ? t('groups.hideArchived')
                : t('groups.showArchived', { count: archived.length })}
              <ChevronDown
                aria-hidden
                className={`size-4 transition-transform ${showArchived ? 'rotate-180' : ''}`}
              />
            </button>
          </h2>
          {showArchived && (
            <ul className="mt-3 grid gap-3 opacity-75 sm:grid-cols-2 xl:grid-cols-3">
              {archived.map((group, i) => (
                <GroupCard key={group.id} group={group} index={i} />
              ))}
            </ul>
          )}
        </section>
      )}

      <CreateGroupSheet open={createOpen} onOpenChange={onCreateOpenChange} />
    </div>
  )
}
