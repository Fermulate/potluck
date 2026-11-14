import type { GroupDetail } from '@potluck/api'
import { can } from '@potluck/core'
import { formatMoney, t } from '@potluck/i18n'
import { Avatar, AvatarStack, Button, cn, Skeleton, usePrefersReducedMotion } from '@potluck/ui'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { CalendarRange, ChevronLeft, History, UserPlus } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useId, useRef, useState } from 'react'
import { recallGroupFilters } from '@/features/insights/group-filters'
import { InviteSheet } from '@/features/invites/invite-sheet'
import { useUserId } from '@/lib/auth'
import { avatarSrc } from '@/lib/queries'
import { GroupCover, GroupTile, ViewerBalance } from './group-bits'
import { tripDatesLabel } from './group-format'
import { MissingGroup } from './recently-deleted'
import { directFriend, displayName, firstName, groupTransitionName, stackPeople } from './people'
import { useGroup, useGroupsRealtime } from './use-groups'

type TabPath =
  | '/groups/$groupId'
  | '/groups/$groupId/balances'
  | '/groups/$groupId/totals'
  | '/groups/$groupId/plans'
  | '/groups/$groupId/notes'
  | '/groups/$groupId/members'
  | '/groups/$groupId/settings'

interface Tab {
  to: TabPath
  label: string
  /** Last path segment, '' for the index tab. */
  segment: string
}

function tabsFor(group: GroupDetail): Tab[] {
  const tabs: Tab[] = [
    { to: '/groups/$groupId', label: t('groups.tabs.expenses'), segment: '' },
    { to: '/groups/$groupId/balances', label: t('groups.tabs.balances'), segment: 'balances' },
    { to: '/groups/$groupId/totals', label: t('insights.tab'), segment: 'totals' },
  ]
  if (group.is_direct) return tabs
  return [
    ...tabs,
    { to: '/groups/$groupId/plans', label: t('groups.tabs.plans'), segment: 'plans' },
    { to: '/groups/$groupId/notes', label: t('groups.tabs.notes'), segment: 'notes' },
    { to: '/groups/$groupId/members', label: t('groups.tabs.members'), segment: 'members' },
    { to: '/groups/$groupId/settings', label: t('groups.tabs.settings'), segment: 'settings' },
  ]
}

function GroupTabs({ group }: { group: GroupDetail }) {
  const indicator = useId()
  const reduced = usePrefersReducedMotion()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const rest = path.split(`/groups/${group.id}`)[1]?.replace(/^\//, '').split('/')[0] ?? ''
  const navRef = useRef<HTMLElement>(null)
  // On phones the tabs scroll sideways. Fade the edge that has more tabs behind it, and bring
  // the current tab into view, so Members and Settings never hide off screen unannounced.
  const [more, setMore] = useState(false)
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const update = () => setMore(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4)
    const current = nav.querySelector<HTMLElement>('[aria-current="page"]')?.parentElement
    if (current) {
      const right = current.offsetLeft + current.offsetWidth - nav.clientWidth + 16
      if (right > nav.scrollLeft) nav.scrollLeft = right
    }
    update()
    nav.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      nav.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [rest])
  return (
    <nav
      ref={navRef}
      aria-label={t('groups.tabs.label')}
      className={cn(
        '-mx-4 scrollbar-none overflow-x-auto px-4 lg:mx-0 lg:px-0',
        more && '[mask-image:linear-gradient(to_right,black_80%,transparent)]',
      )}
    >
      <ul className="flex min-w-max gap-1 border-b border-line">
        {tabsFor(group).map((tab) => {
          // Recently deleted opens from Totals, so Totals stays lit there.
          const active = tab.segment === (rest === 'deleted' ? 'totals' : rest)
          return (
            <li key={tab.to} className="relative">
              <Link
                to={tab.to}
                params={{ groupId: group.id }}
                // Back to Expenses with the filters last used there; on Expenses, the ones in use.
                search={
                  tab.segment !== '' ? undefined : rest === '' ? true : recallGroupFilters(group.id)
                }
                // The index tab is a prefix of every other tab: match it exactly, or the router
                // marks it as the current page everywhere in the group.
                activeOptions={{ exact: tab.segment === '' }}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-11 items-center px-3.5 text-[0.9375rem] font-semibold transition-colors duration-150',
                  active ? 'text-ink' : 'text-mute hover:text-ink',
                )}
              >
                {tab.label}
              </Link>
              {active && (
                <motion.span
                  layoutId={indicator}
                  aria-hidden
                  className="absolute inset-x-2 -bottom-px h-[3px] rounded-pill bg-tomato"
                  transition={
                    reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 38 }
                  }
                />
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

const titleId = (groupId: string) => `group-title-${groupId}`

function BackLink({ direct }: { direct?: boolean }) {
  return (
    <Link
      to={direct ? '/friends' : '/groups'}
      className="-ml-2 inline-flex h-11 items-center gap-1 rounded-pill pr-3 pl-1 text-sm font-semibold text-mute hover:text-ink lg:hidden"
    >
      <ChevronLeft aria-hidden className="size-5" />
      {direct ? t('nav.friends') : t('groups.header.back')}
    </Link>
  )
}

/**
 * The group's name, at most two lines. A longer one ends in an ellipsis: hovering shows it
 * whole (its `title`), and tapping it opens it out. Screen readers always get the full name.
 */
function GroupName({ id, name }: { id: string; name: string }) {
  // The clamp sits on the text itself: a button around it is one box the heading cannot cut.
  const ref = useRef<HTMLSpanElement>(null)
  const [clamped, setClamped] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const tappable = clamped || expanded
  useEffect(() => {
    const text = ref.current
    if (!text) return
    const measure = () => setClamped(text.scrollHeight > text.clientHeight + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(text)
    return () => observer.disconnect()
  }, [name, tappable, expanded])
  const text = (
    <span ref={ref} className={expanded ? 'block' : 'line-clamp-2'}>
      {name}
    </span>
  )
  return (
    <h1
      id={id}
      title={name}
      className="font-display text-[2.5rem] leading-[0.95] tracking-[-0.01em] wrap-anywhere lg:text-5xl"
    >
      {tappable ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="block w-full cursor-pointer rounded-[0.5rem] text-left"
        >
          {text}
        </button>
      ) : (
        text
      )}
    </h1>
  )
}

function SharedHeader({ group, onInvite }: { group: GroupDetail; onInvite: () => void }) {
  const people = stackPeople(group.members)
  const canInvite =
    !group.archived_at &&
    can(group.my_role, 'invite.create', {
      membersCanInvite: group.members_can_invite,
      inviteRole: 'member',
    })
  const dates = tripDatesLabel(group)
  const cover = !!group.cover_path
  return (
    <header className="flex flex-col gap-4">
      {cover && (
        <GroupCover
          path={group.cover_path}
          name={group.name}
          className="aspect-[16/7] rounded-card lg:aspect-[4/3]"
        />
      )}
      <div className="flex items-end gap-4 lg:flex-col lg:items-start">
        <GroupTile
          emoji={group.emoji}
          color={group.color}
          size="lg"
          className={cn(
            'lg:size-24 lg:rounded-[1.5rem] lg:text-[3.25rem]',
            // On a cover the tile sits on its bottom edge, like a place card on a menu.
            cover &&
              'relative z-[1] -mt-12 ml-3 self-start shadow-raised ring-4 ring-[var(--pl-paper)] lg:-mt-16 lg:self-auto',
          )}
          style={{ viewTransitionName: groupTransitionName(group.id) }}
        />
        <div className="min-w-0">
          <GroupName id={titleId(group.id)} name={group.name} />
          {dates && (
            <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-plum-ink">
              <CalendarRange aria-hidden className="size-4" />
              {dates}
            </p>
          )}
          <Link
            to="/groups/$groupId/members"
            params={{ groupId: group.id }}
            className="mt-2 inline-flex items-center gap-2 rounded-pill text-sm text-mute hover:text-ink"
          >
            <AvatarStack
              people={people}
              max={5}
              size="xs"
              label={t('groups.memberCount', { count: people.length })}
            />
            {t('groups.memberCount', { count: people.length })}
          </Link>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-sunken px-4 py-3 lg:flex-col lg:items-stretch">
        <ViewerBalance
          sentence
          cents={group.my_net_cents}
          currency={group.currency}
          className="text-[0.9375rem]"
        />
        {canInvite && (
          <Button size="sm" variant="ink" leadingIcon={<UserPlus />} onClick={onInvite}>
            {t('groups.header.invite')}
          </Button>
        )}
      </div>
      {group.archived_at && (
        <p className="rounded-card border border-dashed border-line-strong px-4 py-2 text-sm text-mute">
          {t('groups.settings.archived', { group: group.name })}
        </p>
      )}
    </header>
  )
}

function DirectHeader({ group }: { group: GroupDetail }) {
  const viewerId = useUserId()
  const friend = directFriend(group, viewerId)
  if (!friend) return null
  const name = displayName(friend)
  const net = group.my_net_cents
  const amount = formatMoney(Math.abs(net), group.currency)
  const line =
    net > 0
      ? t('groups.friendOwesYou', { name: firstName(friend), amount })
      : net < 0
        ? t('groups.youOweFriend', { name: firstName(friend), amount })
        : t('groups.allSquare')
  return (
    <header className="flex items-end gap-4 lg:flex-col lg:items-start">
      <Avatar name={name} seed={friend.id} src={avatarSrc(friend.avatar_path)} size="xl" />
      <div className="min-w-0">
        <p className="flourish text-xl text-mute">{t('groups.direct')}</p>
        <h1
          id={titleId(group.id)}
          className="font-display text-[2.5rem] leading-[0.95] lg:text-5xl"
        >
          {t('groups.header.withFriend', { name: firstName(friend) })}
        </h1>
        <p
          className={cn(
            'mt-2 text-[0.9375rem] font-semibold',
            net > 0 ? 'text-saffron-ink' : net < 0 ? 'text-tomato-ink' : 'text-mute',
          )}
        >
          {line}
        </p>
        <Link
          to="/activity"
          search={{ person: friend.id }}
          className="mt-1 -ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-pill px-1 text-sm font-semibold text-mute hover:text-ink"
        >
          <History aria-hidden className="size-4" />
          {t('activityFilter.personLink', { name: firstName(friend) })}
        </Link>
      </div>
    </header>
  )
}

function HeaderSkeleton() {
  return (
    <div className="flex items-end gap-4 lg:flex-col lg:items-start" aria-hidden>
      <Skeleton className="size-[4.5rem] rounded-[1.25rem] lg:size-24" />
      <div className="grid flex-1 gap-2">
        <Skeleton shape="line" className="h-9 w-48" />
        <Skeleton shape="line" className="w-32" />
      </div>
    </div>
  )
}

/**
 * Frame for every group screen: header, section tabs, then the section. Side by side on
 * desktop. Direct (1:1) groups show the friend instead of group chrome.
 */
export function GroupLayout({ groupId }: { groupId: string }) {
  const { data: group, isPending } = useGroup(groupId)
  const [inviteOpen, setInviteOpen] = useState(false)
  useGroupsRealtime(groupId)

  if (!isPending && !group) return <MissingGroup groupId={groupId} />

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-3 pb-32 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10 lg:px-8 lg:pt-10 lg:pb-12">
      {/* Named after the group, so it is not a second unnamed "complementary" next to the nav. */}
      <aside
        aria-labelledby={group ? titleId(group.id) : undefined}
        className="lg:sticky lg:top-10 lg:self-start"
      >
        <BackLink direct={group?.is_direct} />
        {group ? (
          group.is_direct ? (
            <DirectHeader group={group} />
          ) : (
            <SharedHeader group={group} onInvite={() => setInviteOpen(true)} />
          )
        ) : (
          <HeaderSkeleton />
        )}
      </aside>
      <div className="mt-6 min-w-0 lg:mt-0">
        {group && <GroupTabs group={group} />}
        <div className="pt-5">
          <Outlet />
        </div>
      </div>
      {group && !group.is_direct && (
        <InviteSheet group={group} open={inviteOpen} onOpenChange={setInviteOpen} />
      )}
    </div>
  )
}
