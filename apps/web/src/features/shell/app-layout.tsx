import { t } from '@potluck/i18n'
import {
  AddButton,
  Avatar,
  BottomTabBar,
  Button,
  SideRail,
  type NavItem,
  type RenderNavLink,
} from '@potluck/ui'
import { Link, Outlet, useParams, useRouterState } from '@tanstack/react-router'
import { Bell, CalendarHeart, House, Plus, User, Users } from 'lucide-react'
import { useState } from 'react'
import {
  useNotificationsRealtime,
  useUnreadCount,
} from '@/features/notifications/use-notifications'
import { useUserId } from '@/lib/auth'
import { profileAvatar, useMyProfile } from '@/lib/queries'
import { Wordmark } from './brand'
import { QuickAddSheet } from './quick-add-sheet'

const renderLink: RenderNavLink = ({ href, children, ...props }) => (
  <Link to={href} viewTransition {...props}>
    {children}
  </Link>
)

type TabId = 'home' | 'groups' | 'plans' | 'notifications' | 'me'

function useActiveTab(): TabId {
  const path = useRouterState({ select: (s) => s.location.pathname })
  // An expense lives in a group, so its page keeps Groups lit.
  if (path.startsWith('/groups') || path.startsWith('/friends') || path.startsWith('/expenses'))
    return 'groups'
  if (path.startsWith('/plans') || path.startsWith('/new/plan')) return 'plans'
  if (path.startsWith('/notifications')) return 'notifications'
  if (path.startsWith('/me')) return 'me'
  return 'home'
}

function RailFooter() {
  const userId = useUserId()
  const { data: profile } = useMyProfile()
  const name = profile?.display_name ?? ''
  return (
    <Link
      to="/me"
      className="flex items-center gap-3 rounded-pill p-1.5 pr-3 transition-colors hover:bg-ink/[0.04]"
    >
      <Avatar name={name || '?'} seed={userId} src={profileAvatar(profile)} size="md" />
      <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold">{name}</span>
    </Link>
  )
}

/** Authenticated frame: side rail from `lg`, bottom tabs with the raised add button below it. */
export function AppLayout() {
  const active = useActiveTab()
  const [addOpen, setAddOpen] = useState(false)
  const { groupId } = useParams({ strict: false }) as { groupId?: string }
  const { data: unread = 0 } = useUnreadCount()
  useNotificationsRealtime()

  const home: NavItem = { id: 'home', label: t('nav.home'), icon: <House />, href: '/home' }
  const groups: NavItem = { id: 'groups', label: t('nav.groups'), icon: <Users />, href: '/groups' }
  const plans: NavItem = {
    id: 'plans',
    label: t('nav.plans'),
    icon: <CalendarHeart />,
    href: '/plans',
  }
  const me: NavItem = { id: 'me', label: t('nav.me'), icon: <User />, href: '/me' }
  const inbox: NavItem = {
    id: 'notifications',
    label: t('nav.notifications'),
    icon: <Bell />,
    href: '/notifications',
    badge: unread,
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[auto_minmax(0,1fr)]">
      <a
        href="#main"
        className="fixed top-2 left-2 z-[60] -translate-y-20 rounded-pill bg-ink px-4 py-2 font-semibold text-paper focus:translate-y-0"
      >
        {t('app.skipToContent')}
      </a>
      <SideRail
        items={[home, groups, plans, inbox, me]}
        activeId={active}
        renderLink={renderLink}
        label={t('nav.main')}
        brand={
          <Link to="/home" className="rounded-pill" aria-label={t('nav.home')}>
            <Wordmark />
          </Link>
        }
        action={
          <Button
            block
            size="lg"
            leadingIcon={<Plus strokeWidth={2.5} />}
            aria-haspopup="dialog"
            onClick={() => setAddOpen(true)}
          >
            {t('nav.add')}
          </Button>
        }
        footer={<RailFooter />}
      />
      <main id="main" className="min-w-0">
        <Outlet />
      </main>
      <BottomTabBar
        items={[home, groups, plans, { ...me, badge: unread }]}
        activeId={active === 'notifications' ? 'me' : active}
        renderLink={renderLink}
        label={t('nav.main')}
        centerAction={
          <AddButton
            label={t('nav.add')}
            aria-haspopup="dialog"
            open={addOpen}
            onClick={() => setAddOpen(true)}
          />
        }
      />
      <QuickAddSheet open={addOpen} onOpenChange={setAddOpen} groupId={groupId} />
    </div>
  )
}
