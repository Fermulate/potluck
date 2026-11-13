import {
  createInvite,
  friendsQueryOptions,
  getOrCreateDirectGroup,
  groupKeys,
  paymentKeys,
  paymentQueries,
  type Friend,
} from '@potluck/api'
import { can, friendTotals, type FriendTotal } from '@potluck/core'
import { formatMoney, t } from '@potluck/i18n'
import {
  Avatar,
  Button,
  EmptyState,
  LoadingDots,
  PageHeader,
  Sheet,
  SheetContent,
  Skeleton,
  toast,
} from '@potluck/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { SettleFriendSheet } from './settle-friend-sheet'
import { GroupTile } from '@/features/groups/group-bits'
import { useMyGroups, useMyGroupsRealtime } from '@/features/groups/use-groups'
import { shareInvite } from '@/features/invites/share'
import { useUserId } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { avatarSrc } from '@/lib/queries'
import { supabase } from '@/lib/supabase'

/**
 * What the two of you owe each other across every shared group, per currency. Falls back to the
 * 1:1 tab while the totals load.
 */
function FriendBalance({ friend, total }: { friend: Friend; total: FriendTotal | undefined }) {
  const lines = total
    ? total.byCurrency
    : friend.direct_group_id && friend.currency && friend.net_cents !== 0
      ? [{ currency: friend.currency, netCents: friend.net_cents }]
      : []
  if (lines.length === 0) {
    if (!total && !friend.direct_group_id)
      return <span className="text-sm text-mute">{t('friends.noTab')}</span>
    return <span className="text-sm text-mute">{t('friends.settled')}</span>
  }
  // Each direction gets its own line, so "you owe" never covers money they owe you.
  const directions = [
    { owedToYou: false, items: lines.filter((l) => l.netCents < 0) },
    { owedToYou: true, items: lines.filter((l) => l.netCents > 0) },
  ].filter((d) => d.items.length > 0)
  const amounts = (items: typeof lines) =>
    items
      .map((l) => formatMoney(Math.abs(l.netCents), l.currency))
      .reduce((a, b) => t('friends.and', { first: a, second: b }))
  const label = (owedToYou: boolean) =>
    (owedToYou ? t('friends.owesYou', { amount: '' }) : t('friends.youOwe', { amount: '' })).trim()
  const tone = (owedToYou: boolean) => (owedToYou ? 'text-saffron-ink' : 'text-tomato-ink')

  if (directions.length === 1) {
    const [only] = directions
    return (
      <span className="flex flex-col items-end text-right leading-tight">
        <span className="text-xs text-mute">{label(only!.owedToYou)}</span>
        <span className={`tabular text-[0.9375rem] font-bold ${tone(only!.owedToYou)}`}>
          {amounts(only!.items)}
        </span>
      </span>
    )
  }
  return (
    <span className="flex flex-col items-end gap-0.5 text-right leading-tight">
      {directions.map((d) => (
        <span key={String(d.owedToYou)} className="flex items-baseline gap-1.5">
          <span className="text-xs text-mute">{label(d.owedToYou)}</span>
          <span className={`tabular text-[0.9375rem] font-bold ${tone(d.owedToYou)}`}>
            {amounts(d.items)}
          </span>
        </span>
      ))}
    </span>
  )
}

/** One-person invites for friends expire after a week. */
function weekFromNow(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
}

function AddFriendSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { data: groups = [] } = useMyGroups()
  const [busy, setBusy] = useState<string | null>(null)
  const invitable = groups.filter(
    (g) =>
      !g.is_direct &&
      !g.archived_at &&
      can(g.my_role, 'invite.create', {
        membersCanInvite: g.members_can_invite,
        inviteRole: 'member',
      }),
  )

  async function invite(groupId: string, name: string) {
    setBusy(groupId)
    try {
      const created = await createInvite(supabase, {
        groupId,
        maxUses: 1,
        expiresAt: weekFromNow(),
      })
      await shareInvite(name, created.code)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={t('friends.addTitle')}
        description={t('friends.addBody')}
        closeLabel={t('common.close')}
        size="sm"
      >
        {invitable.length === 0 ? (
          <div className="grid justify-items-start gap-3 pt-2">
            <p className="text-sm text-mute">{t('friends.noGroups')}</p>
            <Button asChild variant="secondary">
              <Link to="/groups" search={{ new: true }} onClick={() => onOpenChange(false)}>
                {t('groups.new')}
              </Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-1 pt-2">
            <p className="mb-1 text-sm font-semibold">{t('friends.pickGroup')}</p>
            {invitable.map((g) => (
              <button
                key={g.id}
                type="button"
                disabled={!!busy}
                onClick={() => void invite(g.id, g.name)}
                className="flex items-center gap-3 rounded-card p-2.5 text-left transition-colors hover:bg-sunken disabled:opacity-60"
              >
                <GroupTile emoji={g.emoji} color={g.color} size="sm" />
                <span className="flex-1 font-semibold">{g.name}</span>
                {busy === g.id ? (
                  <LoadingDots size={16} />
                ) : (
                  <ChevronRight aria-hidden className="size-4 text-mute" />
                )}
              </button>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

const FRIEND_TABLES = [{ table: 'expenses' }, { table: 'settlements' }, { table: 'group_members' }]

export function FriendsPage() {
  const userId = useUserId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: friends, isPending } = useQuery(friendsQueryOptions(supabase, userId))
  const [opening, setOpening] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [settling, setSettling] = useState<Friend | null>(null)
  const balances = useQuery(paymentQueries.friendBalances(supabase))
  const totals = useMemo(
    () => (balances.data ? friendTotals(balances.data) : undefined),
    [balances.data],
  )
  useMyGroupsRealtime('friends-live', FRIEND_TABLES, () => [
    groupKeys.friends(userId),
    paymentKeys.friendBalances(),
  ])

  async function open(friend: Friend) {
    setOpening(friend.id)
    try {
      const groupId = friend.direct_group_id ?? (await getOrCreateDirectGroup(supabase, friend.id))
      if (!friend.direct_group_id) void queryClient.invalidateQueries({ queryKey: groupKeys.all })
      await navigate({ to: '/groups/$groupId', params: { groupId } })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-3 pb-32 lg:px-8 lg:pt-10 lg:pb-12">
      <Link
        to="/groups"
        className="-ml-2 inline-flex h-11 items-center gap-1 rounded-pill pr-3 pl-1 text-sm font-semibold text-mute hover:text-ink"
      >
        <ChevronLeft aria-hidden className="size-5" />
        {t('nav.groups')}
      </Link>
      <PageHeader
        title={t('friends.title')}
        subtitle={t('friends.subtitle')}
        actions={
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<UserPlus />}
            onClick={() => setAddOpen(true)}
          >
            {t('friends.add')}
          </Button>
        }
      />

      <div className="mt-6">
        {isPending ? (
          <ul className="grid gap-2" aria-hidden>
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 rounded-card bg-card p-3">
                <Skeleton shape="circle" className="size-10" />
                <Skeleton shape="line" className="w-40" />
              </li>
            ))}
          </ul>
        ) : !friends || friends.length === 0 ? (
          <EmptyState
            illustration="👋"
            title={t('friends.empty.title')}
            description={t('friends.empty.body')}
            action={
              <Button leadingIcon={<UserPlus />} onClick={() => setAddOpen(true)}>
                {t('friends.empty.action')}
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-2">
            {friends.map((friend) => {
              const total = totals?.get(friend.id)
              const groupsWithBalance = total ? total.settleable.length + total.archived.length : 0
              return (
                <li
                  key={friend.id}
                  className="overflow-hidden rounded-card border border-line bg-card transition-[border-color] duration-150 hover:border-ink/25"
                >
                  <button
                    type="button"
                    onClick={() => void open(friend)}
                    className="flex w-full items-center gap-3 p-3 text-left transition-transform duration-150 active:scale-[0.99]"
                  >
                    <Avatar
                      name={friend.display_name}
                      seed={friend.id}
                      src={avatarSrc(friend.avatar_path)}
                    />
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {friend.display_name}
                    </span>
                    {opening === friend.id ? (
                      <LoadingDots size={16} />
                    ) : (
                      <FriendBalance friend={friend} total={totals ? total : undefined} />
                    )}
                    <ChevronRight aria-hidden className="size-4 text-mute" />
                  </button>
                  {total && total.settleable.length > 0 && (
                    <div className="flex items-center gap-3 border-t border-dashed border-line bg-sunken/50 py-2 pr-2 pl-[3.75rem]">
                      <span className="min-w-0 flex-1 truncate text-sm text-mute">
                        {t('friends.acrossGroups', { count: groupsWithBalance })}
                      </span>
                      <Button
                        size="sm"
                        variant="ink"
                        aria-label={t('friends.settle.actionLabel', {
                          name: friend.display_name,
                        })}
                        onClick={() => setSettling(friend)}
                      >
                        {t('friends.settle.action')}
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <AddFriendSheet open={addOpen} onOpenChange={setAddOpen} />
      {settling && totals?.get(settling.id) && (
        <SettleFriendSheet
          friend={settling}
          total={totals.get(settling.id)!}
          open
          onOpenChange={(o) => !o && setSettling(null)}
        />
      )}
    </div>
  )
}
