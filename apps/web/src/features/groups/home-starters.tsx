import { HOME_STARTERS, categoryEmoji } from '@potluck/core'
import { t } from '@potluck/i18n'
import { Link } from '@tanstack/react-router'
import { Repeat } from 'lucide-react'
import { useGroup } from './use-groups'

/**
 * A home group's first nudge: the bills most homes split every month, one tap from a repeating
 * expense. Renders nothing for other group types or archived groups.
 */
export function HomeStarters({ groupId }: { groupId: string }) {
  const { data: group } = useGroup(groupId)
  if (!group || group.type !== 'home' || group.archived_at) return null
  return (
    <section
      aria-labelledby={`starters-${groupId}`}
      className="grid gap-3 rounded-card border border-line bg-card p-4"
    >
      <div>
        <h3 id={`starters-${groupId}`} className="font-display text-xl">
          {t('groups.starters.title')}
        </h3>
        <p className="text-sm text-mute">{t('groups.starters.body')}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {HOME_STARTERS.map((preset) => (
          <Link
            key={preset}
            to="/new/expense"
            search={{ groupId, preset }}
            className="flex items-center gap-3 rounded-[0.875rem] border border-line-strong px-3 py-3 font-semibold transition-[border-color,transform] duration-150 hover:border-ink/40 active:scale-[0.98]"
          >
            <span aria-hidden className="text-2xl leading-none">
              {categoryEmoji(preset)}
            </span>
            <span className="min-w-0 flex-1 text-[0.9375rem] leading-tight">
              {t(`groups.starters.${preset}`)}
            </span>
            <Repeat aria-hidden className="size-4 shrink-0 text-mute" />
          </Link>
        ))}
      </div>
    </section>
  )
}
