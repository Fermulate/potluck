import { AddButton, BottomTabBar, cn, type NavItem } from '@potluck/ui'
import { CalendarDays, House, UserRound, UsersRound } from 'lucide-react'
import type { ReactNode } from 'react'

export const tabs: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    icon: <House />,
    activeIcon: <House strokeWidth={2.5} />,
    href: '#',
  },
  {
    id: 'groups',
    label: 'Groups',
    icon: <UsersRound />,
    activeIcon: <UsersRound strokeWidth={2.5} />,
    href: '#',
  },
  {
    id: 'plans',
    label: 'Plans',
    icon: <CalendarDays />,
    activeIcon: <CalendarDays strokeWidth={2.5} />,
    href: '#',
    badge: 2,
  },
  {
    id: 'me',
    label: 'Me',
    icon: <UserRound />,
    activeIcon: <UserRound strokeWidth={2.5} />,
    href: '#',
  },
]

/** A 390 x 844 device frame. Content scrolls inside; the tab bar stays put. */
export function Phone({
  label,
  activeTab,
  children,
  className,
}: {
  label: string
  activeTab?: string
  children: ReactNode
  className?: string
}) {
  return (
    <figure className={cn('flex shrink-0 flex-col items-center gap-4', className)}>
      <div
        className="relative isolate h-[50rem] w-[24.375rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[2.75rem] border border-line bg-paper shadow-raised"
        style={{ contain: 'paint' }}
      >
        <div
          aria-hidden
          className="flex h-11 items-center justify-between px-8 pt-1 tabular text-[0.8125rem] font-semibold text-ink"
        >
          <span>9:41</span>
          <span className="h-[1.375rem] w-24 rounded-pill bg-ink" />
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-4 rounded-[3px] border border-ink/70" />
          </span>
        </div>
        <div className="scrollbar-none h-[calc(100%-2.75rem)] overflow-y-auto pb-28">
          {children}
        </div>
        {activeTab && (
          <BottomTabBar
            label="Main"
            items={tabs}
            activeId={activeTab}
            centerAction={<AddButton label="Add" size="md" />}
            className="absolute pb-3 lg:block"
          />
        )}
      </div>
      <figcaption className="text-sm text-mute">{label}</figcaption>
    </figure>
  )
}
