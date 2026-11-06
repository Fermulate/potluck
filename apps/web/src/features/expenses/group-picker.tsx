import { avatarSrc } from '@/lib/queries'
import { firstName } from '@potluck/core'
import { moneyQueries, type MoneyGroup } from '@potluck/api'
import { groupTitle } from './format'
import { t } from '@potluck/i18n'
import { AvatarStack, Card, EmptyState, Skeleton } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

/** Big tappable list of the viewer's groups, for flows started without one. */
export function GroupPicker({
  title,
  hint,
  onPick,
}: {
  title: string
  hint?: string
  onPick: (group: MoneyGroup) => void
}) {
  const me = useUserId()
  const { data, isPending } = useQuery(moneyQueries.myGroups(supabase))

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-3xl leading-tight">{title}</h2>
        {hint && <p className="mt-1 text-[0.9375rem] text-mute">{hint}</p>}
      </div>
      {isPending ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[4.5rem]" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState title={t('empty.groups.title')} description={t('expenses.pickGroup.none')} />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {data.map((group) => (
            <li key={group.id}>
              <Card asChild interactive padding="none">
                <button
                  type="button"
                  onClick={() => onPick(group)}
                  className="flex w-full items-center gap-3 px-4 py-3"
                >
                  <span
                    aria-hidden
                    className="grid size-12 shrink-0 rotate-[-4deg] place-items-center rounded-[1rem] bg-olive-soft text-[1.75rem]"
                  >
                    {group.emoji ?? (group.is_direct ? '🤝' : '🍽️')}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-base font-bold">{groupTitle(group, me)}</span>
                    <AvatarStack
                      size="xs"
                      max={5}
                      people={group.members.map((m) => ({
                        id: m.id,
                        name: m.display_name,
                        src: avatarSrc(m.avatar_path),
                      }))}
                      label={group.members.map((m) => firstName(m.display_name)).join(', ')}
                    />
                  </span>
                  <ChevronRight aria-hidden className="size-5 text-mute" />
                </button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
