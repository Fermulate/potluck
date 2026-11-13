import { t } from '@potluck/i18n'
import { buttonClassName, cn } from '@potluck/ui'
import { Link } from '@tanstack/react-router'
import { ChevronRight, History } from 'lucide-react'

/** A row that opens the activity feed, for Home. */
export function RecentActivityRow() {
  return (
    <Link
      to="/activity"
      className="flex items-center gap-3 rounded-card border border-line bg-card px-4 py-3 transition-colors hover:border-ink/30"
    >
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-full bg-plum-soft text-plum-ink"
      >
        <History className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{t('activity.recent')}</span>
        <span className="block truncate text-sm text-mute">{t('activity.recentHint')}</span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-mute" />
    </Link>
  )
}

/** A round icon link to the activity feed (one group's, with `groupId`), for toolbars. */
export function ActivityIconLink({ className, groupId }: { className?: string; groupId?: string }) {
  const label = groupId ? t('insights.links.activity') : t('activity.recent')
  return (
    <Link
      to="/activity"
      search={groupId ? { groupId } : {}}
      aria-label={label}
      title={label}
      className={cn(
        buttonClassName({ variant: 'secondary' }),
        'size-11 px-0 [&_svg]:size-5',
        className,
      )}
    >
      <History aria-hidden />
    </Link>
  )
}
