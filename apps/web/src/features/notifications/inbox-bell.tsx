import { t } from '@potluck/i18n'
import { cn } from '@potluck/ui'
import { Link } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { useUnreadCount } from './use-notifications'

/**
 * A bell that opens the inbox, with the unread count. Phones have no inbox tab (the count rides
 * on Me with a small bell), so Home and Me carry this.
 */
export function InboxBell({ className }: { className?: string }) {
  const { data: unread = 0 } = useUnreadCount()
  return (
    <Link
      to="/notifications"
      className={cn(
        'relative grid size-11 shrink-0 place-items-center rounded-full border border-line-strong bg-card text-ink transition-colors hover:border-ink/40',
        className,
      )}
    >
      <Bell aria-hidden className="size-5" />
      <span className="sr-only">
        {t('nav.notifications')}
        {unread > 0 && ` (${t('notifications.unread', { count: unread })})`}
      </span>
      {unread > 0 && (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-pill bg-tomato-strong px-1 tabular text-[0.6875rem] font-bold text-on-tomato ring-2 ring-paper"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  )
}
