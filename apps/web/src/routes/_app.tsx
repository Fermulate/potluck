import { createFileRoute, Link, Outlet, redirect, useRouterState } from '@tanstack/react-router'
import { t } from '@potluck/i18n'
import { BottomTabBar, SideRail, type NavItem, type RenderNavLink } from '@potluck/ui'
import { CalendarHeart, House, User, Users } from 'lucide-react'
import { getSession } from '@/lib/auth'

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    const session = await getSession()
    if (!session) throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    return { session }
  },
  component: AppLayout,
})

const renderLink: RenderNavLink = ({ href, children, ...props }) => (
  <Link to={href} {...props}>
    {children}
  </Link>
)

function useActiveTab(): string {
  const path = useRouterState({ select: (s) => s.location.pathname })
  if (path.startsWith('/groups') || path.startsWith('/friends')) return 'groups'
  if (path.startsWith('/plans')) return 'plans'
  if (path.startsWith('/me') || path.startsWith('/notifications')) return 'me'
  return 'home'
}

function AppLayout() {
  const activeId = useActiveTab()
  const items: NavItem[] = [
    { id: 'home', label: t('nav.home'), icon: <House />, href: '/home' },
    { id: 'groups', label: t('nav.groups'), icon: <Users />, href: '/groups' },
    { id: 'plans', label: t('nav.plans'), icon: <CalendarHeart />, href: '/plans' },
    { id: 'me', label: t('nav.me'), icon: <User />, href: '/me' },
  ]
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[auto_minmax(0,1fr)]">
      <SideRail
        className="hidden lg:flex"
        items={items}
        activeId={activeId}
        renderLink={renderLink}
        label={t('nav.home')}
      />
      <main className="min-w-0">
        <Outlet />
      </main>
      <BottomTabBar
        className="lg:hidden"
        items={items}
        activeId={activeId}
        renderLink={renderLink}
        label={t('nav.home')}
      />
    </div>
  )
}
