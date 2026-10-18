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
import { useGroupsRealtime, useMyGroups } from './use-groups'

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
        className="group flex h-full items-center gap-4 rounded-card border border-line bg-card p-4 transition-[border-color,transform] duration-150 [--avatar-ring:var(--pl-card)] hover:border-ink/25 active:scale-[0.99]"
      >
        <GroupTile
          emoji={group.emoji}
          color={group.color}
          size="md"
          className="transition-transform duration-200 group-hover:rotate-[-8deg]"
          style={{ viewTransitionName: groupTransitionName(group.id) }}
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[1.0625rem] font-bold tracking-tight">{group.name}</h3>
          <div className="mt-1.5 flex items-center gap-2">
            <AvatarStack
              people={people}
              max={4}
              size="xs"
              label={t('groups.memberCount', { count: people.length })}
            />
            <span className="text-xs text-mute">
              {t('groups.memberCount', { count: people.length })}
            </span>
          </div>
        </div>
        <ViewerBalance
          cents={group.my_net_cents}
          currency={group.currency}
          className="max-w-[9rem] text-right leading-tight"
        />
      </Link>
    </motion.li>
  )
}

function GroupsSkeleton() {
  return (
    <ul className="grid gap-3 md:grid-cols-2" aria-hidden>
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
  useGroupsRealtime()

  const shared = (data ?? []).filter((g) => !g.is_direct)
  const active = shared.filter((g) => !g.archived_at)
  const archived = shared.filter((g) => g.archived_at)

  const newButton = (
    <Button leadingIcon={<Plus />} onClick={() => onCreateOpenChange(true)}>
      {t('groups.new')}
    </Button>
  )

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pt-6 pb-32 lg:px-8 lg:pt-10 lg:pb-12">
      <PageHeader
        title={t('groups.title')}
        subtitle={t('groups.subtitle')}
        actions={<div className="hidden sm:block">{newButton}</div>}
      />

      <div className="mt-6 flex flex-wrap gap-2">
        <Button asChild variant="secondary" size="sm" leadingIcon={<UsersRound />}>
          <Link to="/friends">{t('nav.friends')}</Link>
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
          <ul className="grid gap-3 md:grid-cols-2">
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
            <ul className="mt-3 grid gap-3 opacity-75 md:grid-cols-2">
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
