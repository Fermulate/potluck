import {
  createInvite,
  friendsQueryOptions,
  getOrCreateDirectGroup,
  groupKeys,
  type Friend,
} from '@potluck/api'
import { can } from '@potluck/core'
import { DEFAULT_LOCALE, formatMoney, t } from '@potluck/i18n'
import {
  Amount,
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
import { useState } from 'react'
import { GroupTile } from '@/features/groups/group-bits'
import { useMyGroups } from '@/features/groups/use-groups'
import { shareInvite } from '@/features/invites/share'
import { useUserId } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { avatarSrc } from '@/lib/queries'
import { useRealtime } from '@/lib/realtime'
import { supabase } from '@/lib/supabase'

function FriendBalance({ friend }: { friend: Friend }) {
  if (!friend.direct_group_id) return <span className="text-sm text-mute">{t('friends.noTab')}</span>
  if (friend.net_cents === 0 || !friend.currency) {
    return <span className="text-sm text-mute">{t('friends.settled')}</span>
  }
  const amount = formatMoney(Math.abs(friend.net_cents), friend.currency)
  const label =
    friend.net_cents > 0 ? t('friends.owesYou', { amount }) : t('friends.youOwe', { amount })
  return (
    <span className="flex flex-col items-end text-right leading-tight">
      <span className="sr-only">{label}</span>
      <span aria-hidden className="text-xs text-mute">
        {label.replace(amount, '').trim()}
      </span>
      <Amount
        cents={Math.abs(friend.net_cents)}
        currency={friend.currency}
        locale={DEFAULT_LOCALE}
        tone={friend.net_cents > 0 ? 'owed' : 'owe'}
        className="text-[0.9375rem] font-bold"
        srLabel=""
      />
    </span>
  )
}

function AddFriendSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: groups = [] } = useMyGroups()
  const [busy, setBusy] = useState<string | null>(null)
  const invitable = groups.filter(
    (g) =>
      !g.is_direct &&
      !g.archived_at &&
      can(g.my_role, 'invite.create', { membersCanInvite: g.members_can_invite, inviteRole: 'member' }),
  )

  async function invite(groupId: string, name: string) {
    setBusy(groupId)
    try {
      const created = await createInvite(supabase, {
        groupId,
        maxUses: 1,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
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
                {busy === g.id ? <LoadingDots size={16} /> : <ChevronRight aria-hidden className="size-4 text-mute" />}
              </button>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

export function FriendsPage() {
  const userId = useUserId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: friends, isPending } = useQuery(friendsQueryOptions(supabase, userId))
  const [opening, setOpening] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  useRealtime('friends-live', [{ table: 'expenses' }, { table: 'settlements' }, { table: 'group_members' }], () => {
    void queryClient.invalidateQueries({ queryKey: groupKeys.friends(userId) })
  })

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
          <Button size="sm" variant="secondary" leadingIcon={<UserPlus />} onClick={() => setAddOpen(true)}>
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
            {friends.map((friend) => (
              <li key={friend.id}>
                <button
                  type="button"
                  onClick={() => void open(friend)}
                  aria-label={t('friends.open', { name: friend.display_name })}
                  className="flex w-full items-center gap-3 rounded-card border border-line bg-card p-3 text-left transition-[border-color,transform] duration-150 hover:border-ink/25 active:scale-[0.99]"
                >
                  <Avatar name={friend.display_name} seed={friend.id} src={avatarSrc(friend.avatar_path)} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{friend.display_name}</span>
                  {opening === friend.id ? <LoadingDots size={16} /> : <FriendBalance friend={friend} />}
                  <ChevronRight aria-hidden className="size-4 text-mute" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <AddFriendSheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  )
}
