import {
  groupKeys,
  leaveGroup,
  peopleKeys,
  removeMember,
  removePlaceholder,
  setMemberRole,
  transferOwnership,
  type GroupDetail,
  type GroupMember,
  type GroupRole,
} from '@potluck/api'
import { can } from '@potluck/core'
import { intlLocale, formatDate, formatMoney, t } from '@potluck/i18n'
import {
  Amount,
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  IconButton,
  Sheet,
  SheetContent,
  Skeleton,
  toast,
  type BadgeTone,
} from '@potluck/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowUpRight,
  Crown,
  LogOut,
  MoreHorizontal,
  ShieldCheck,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Help } from '@/features/help/help'
import { InvitePanel, InviteSheet } from '@/features/invites/invite-sheet'
import { useUserId } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { avatarSrc, useViewerTimezone } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { displayName } from './people'
import {
  canAddPeople,
  placeholderActions,
  placeholderLine,
  usePlaceholders,
} from './placeholder-helpers'
import {
  AddPlaceholderSheet,
  AddSeatRow,
  EditPlaceholderSheet,
  PlaceholderMenu,
} from './placeholders'
import { useGroup } from './use-groups'

const roleTone: Record<GroupRole, BadgeTone> = {
  owner: 'saffron',
  admin: 'plum',
  member: 'neutral',
}

function MemberBalance({ member, currency }: { member: GroupMember; currency: string }) {
  if (member.net_cents === 0)
    return <span className="text-sm text-mute">{t('members.settled')}</span>
  const amount = formatMoney(Math.abs(member.net_cents), currency)
  const label =
    member.net_cents > 0
      ? t('members.balanceOwed', { amount })
      : t('members.balanceOwes', { amount })
  return (
    <span className="flex flex-col items-end text-right leading-tight">
      <span className="sr-only">{label}</span>
      <span aria-hidden className="text-xs text-mute">
        {label.replace(amount, '').trim()}
      </span>
      <Amount
        cents={Math.abs(member.net_cents)}
        currency={currency}
        locale={intlLocale()}
        tone={member.net_cents > 0 ? 'owed' : 'owe'}
        className="text-[0.9375rem] font-bold"
        srLabel=""
      />
    </span>
  )
}

type PendingAction =
  | { kind: 'role'; member: GroupMember; role: GroupRole }
  | { kind: 'transfer'; member: GroupMember }
  | { kind: 'remove'; member: GroupMember }
  | { kind: 'removePlaceholder'; member: GroupMember }
  | { kind: 'leave' }

function ActionRow({
  icon,
  label,
  hint,
  onClick,
  danger,
  disabled,
}: {
  icon: ReactNode
  label: string
  hint?: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-card p-3 text-left transition-colors hover:bg-sunken disabled:opacity-50"
    >
      <span
        aria-hidden
        className={`grid size-10 shrink-0 place-items-center rounded-full [&_svg]:size-5 ${danger ? 'bg-tomato-soft text-tomato-ink' : 'bg-sunken text-ink'}`}
      >
        {icon}
      </span>
      <span>
        <span className={`block font-semibold ${danger ? 'text-tomato-ink' : ''}`}>{label}</span>
        {hint && <span className="block text-sm text-mute">{hint}</span>}
      </span>
    </button>
  )
}

/**
 * What the viewer may do to `member`, straight from `can()`. `remove` is the role check alone so
 * the action can show disabled with a hint; `removable` also needs a settled balance.
 */
function memberActions(group: GroupDetail, member: GroupMember) {
  const role = group.my_role
  const active = !member.deleted_at
  return {
    promote:
      active && can(role, 'member.changeRole', { targetRole: member.role, newRole: 'admin' }),
    demote:
      active && can(role, 'member.changeRole', { targetRole: member.role, newRole: 'member' }),
    transfer: active && can(role, 'group.transferOwnership'),
    remove: can(role, 'member.remove', { targetRole: member.role, targetNetCents: 0 }),
    removable: can(role, 'member.remove', {
      targetRole: member.role,
      targetNetCents: member.net_cents,
    }),
  }
}

function hasMemberActions(
  group: GroupDetail,
  member: GroupMember,
  viewerId: string,
  placeholders: ReturnType<typeof usePlaceholders>['data'],
) {
  if (member.id === viewerId) return false
  if (member.is_placeholder) {
    const { share, remind, edit, remove } = placeholderActions(
      group,
      member,
      placeholders?.get(member.id),
      viewerId,
    )
    return share || remind || edit || remove
  }
  const { promote, demote, transfer, remove } = memberActions(group, member)
  return promote || demote || transfer || remove
}

function MemberActions({
  group,
  member,
  onPick,
}: {
  group: GroupDetail
  member: GroupMember
  onPick: (action: PendingAction) => void
}) {
  const name = displayName(member)
  const { promote, demote, transfer, remove, removable } = memberActions(group, member)

  return (
    <div className="grid gap-1">
      {promote && (
        <ActionRow
          icon={<ShieldCheck />}
          label={t('members.makeAdmin')}
          hint={t('roles.admin.description')}
          onClick={() => onPick({ kind: 'role', member, role: 'admin' })}
        />
      )}
      {demote && (
        <ActionRow
          icon={<ArrowUpRight className="rotate-90" />}
          label={t('members.makeMember')}
          hint={t('roles.member.description')}
          onClick={() => onPick({ kind: 'role', member, role: 'member' })}
        />
      )}
      {transfer && (
        <ActionRow
          icon={<Crown />}
          label={t('members.makeOwner')}
          hint={t('groups.settings.transferConfirm', { name })}
          onClick={() => onPick({ kind: 'transfer', member })}
        />
      )}
      {remove && (
        <ActionRow
          danger
          icon={<UserMinus />}
          label={t('members.remove')}
          hint={removable ? undefined : t('members.removeBlocked', { name })}
          disabled={!removable}
          onClick={() => onPick({ kind: 'remove', member })}
        />
      )}
    </div>
  )
}

function MembersSkeleton() {
  return (
    <ul className="grid gap-2" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} className="flex items-center gap-3 rounded-card bg-card p-3">
          <Skeleton shape="circle" className="size-10" />
          <Skeleton shape="line" className="w-40" />
        </li>
      ))}
    </ul>
  )
}

export function MembersPage({ groupId }: { groupId: string }) {
  const viewerId = useUserId()
  const timeZone = useViewerTimezone()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: group, isPending } = useGroup(groupId)
  const { data: placeholders } = usePlaceholders(groupId)
  const [menuFor, setMenuFor] = useState<GroupMember | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<GroupMember | null>(null)

  if (isPending || !group) return <MembersSkeleton />

  const me = group.members.find((m) => m.id === viewerId)
  const canInvite =
    !group.is_direct &&
    !group.archived_at &&
    can(group.my_role, 'invite.create', {
      membersCanInvite: group.members_can_invite,
      inviteRole: 'member',
    })
  const lastMember = group.members.length === 1
  // A brand new group: put the invite link right here instead of behind a button.
  const alone = canInvite && lastMember
  // Only closed accounts and people not on Potluck yet are left with the owner: nobody can take
  // over, so leaving deletes the group (the server checks nobody still has an open balance).
  const onlyClosedLeft =
    !lastMember &&
    group.members.every((m) => m.id === viewerId || Boolean(m.deleted_at) || m.is_placeholder)
  const ownerClosesGroup = me?.role === 'owner' && onlyClosedLeft
  // Who is left decides the wording: saved seats are not closed accounts.
  const seatsLeft = group.members.some((m) => m.is_placeholder)
  const canLeave = me
    ? can(me.role, 'group.leave', { netCents: me.net_cents }) ||
      (me.role === 'owner' && lastMember && me.net_cents === 0) ||
      ownerClosesGroup
    : false
  const leaveNote = !me
    ? undefined
    : ownerClosesGroup
      ? seatsLeft
        ? t('people.placeholder.leaveOnlySeats')
        : t('groups.settings.leaveLastActive')
      : me.net_cents !== 0
        ? t('groups.settings.leaveBlocked')
        : me.role === 'owner' && !lastMember
          ? t('groups.settings.ownerCannotLeave')
          : undefined

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: groupKeys.all }),
      queryClient.invalidateQueries({ queryKey: peopleKeys.placeholders(groupId) }),
    ])

  async function run(action: PendingAction) {
    try {
      switch (action.kind) {
        case 'role':
          await setMemberRole(supabase, group!.id, action.member.id, action.role)
          toast.success(
            t('members.roleChanged', {
              name: displayName(action.member),
              role: t(`roles.${action.role}.label`).toLowerCase(),
            }),
          )
          break
        case 'transfer':
          await transferOwnership(supabase, group!.id, action.member.id)
          toast.success(t('members.transferred', { name: displayName(action.member) }))
          break
        case 'remove':
          await removeMember(supabase, group!.id, action.member.id)
          toast.success(t('members.removed', { name: displayName(action.member) }))
          break
        case 'removePlaceholder':
          await removePlaceholder(supabase, action.member.id)
          toast.success(t('people.placeholder.removed', { name: action.member.display_name }))
          break
        case 'leave':
          await leaveGroup(supabase, group!.id)
          toast.success(t('groups.settings.left', { group: group!.name }))
          await navigate({ to: '/groups', replace: true })
          break
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      await refresh()
    }
  }

  const confirmCopy = (action: PendingAction) => {
    switch (action.kind) {
      case 'role':
        return {
          title: action.role === 'admin' ? t('members.makeAdmin') : t('members.makeMember'),
          description: t(`roles.${action.role}.description`),
          confirm: t('common.confirm'),
          tone: 'primary' as const,
        }
      case 'transfer':
        return {
          title: t('groups.settings.transfer'),
          description: t('groups.settings.transferConfirm', { name: displayName(action.member) }),
          confirm: t('members.makeOwner'),
          tone: 'primary' as const,
        }
      case 'removePlaceholder':
        return {
          title: t('people.placeholder.remove', { name: action.member.display_name }),
          description: t('people.placeholder.removeConfirm', {
            name: action.member.display_name,
            group: group!.name,
          }),
          confirm: t('common.remove'),
          tone: 'danger' as const,
        }
      case 'remove':
        return {
          title: t('members.remove'),
          description: t('members.removeConfirm', {
            name: displayName(action.member),
            group: group!.name,
          }),
          confirm: t('common.remove'),
          tone: 'danger' as const,
        }
      case 'leave':
        return {
          title: t('groups.settings.leave'),
          description: ownerClosesGroup
            ? seatsLeft
              ? t('people.placeholder.leaveOnlySeatsConfirm', { group: group!.name })
              : t('groups.settings.leaveLastActiveConfirm', { group: group!.name })
            : t('groups.settings.leaveConfirm', { group: group!.name }),
          confirm: t('members.leave'),
          tone: 'danger' as const,
        }
    }
  }
  const copy = pending ? confirmCopy(pending) : null

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-3xl">{t('members.title')}</h2>
          <Help topic="roles" align="start" />
        </div>
        {canInvite && !alone && (
          <Button size="sm" leadingIcon={<UserPlus />} onClick={() => setInviteOpen(true)}>
            {t('members.invite')}
          </Button>
        )}
      </div>

      <ul className="grid grid-cols-1 gap-2">
        {group.members.map((member) => {
          const name = displayName(member)
          const isMe = member.id === viewerId
          const seat = member.is_placeholder
          return (
            <li
              key={member.id}
              className={
                seat
                  ? 'flex items-center gap-3 rounded-card border border-dashed border-line-strong bg-card p-3 [--avatar-ring:var(--pl-card)]'
                  : 'flex items-center gap-3 rounded-card border border-line bg-card p-3 [--avatar-ring:var(--pl-card)]'
              }
            >
              <Avatar
                name={name}
                seed={member.id}
                src={avatarSrc(member.avatar_path)}
                size="md"
                className={seat ? 'opacity-75 grayscale-[35%]' : undefined}
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate font-semibold">
                    {isMe ? t('members.you', { name }) : name}
                  </span>
                  {member.role !== 'member' && (
                    <Badge tone={roleTone[member.role]}>{t(`roles.${member.role}.label`)}</Badge>
                  )}
                  {seat && <Badge tone="neutral">{t('people.placeholder.badge')}</Badge>}
                </p>
                <p className={seat ? 'text-xs text-mute' : 'truncate text-xs text-mute'}>
                  {seat
                    ? placeholderLine(placeholders?.get(member.id), timeZone)
                    : t('members.joined', {
                        date: formatDate(member.joined_at, { timeZone, style: 'medium' }),
                      })}
                </p>
              </div>
              <MemberBalance member={member} currency={group.currency} />
              {hasMemberActions(group, member, viewerId, placeholders) ? (
                <IconButton
                  size="sm"
                  label={t('members.actions', { name })}
                  icon={<MoreHorizontal />}
                  onClick={() => setMenuFor(member)}
                />
              ) : (
                <span className="w-9" aria-hidden />
              )}
            </li>
          )
        })}
        {canAddPeople(group) && <AddSeatRow onClick={() => setAddOpen(true)} />}
      </ul>

      {alone && (
        <section
          aria-labelledby="members-alone"
          className="grid gap-4 rounded-card border border-dashed border-line-strong p-4 sm:p-6"
        >
          <div>
            <h3 id="members-alone" className="flourish text-3xl leading-tight">
              {t('members.alone.title')}
            </h3>
            <p className="mt-1 text-pretty text-mute">{t('members.alone.body')}</p>
          </div>
          <InvitePanel group={group} intro={false} />
        </section>
      )}

      {me && !group.is_direct && (
        <div className="grid justify-items-start gap-2 border-t border-line pt-6">
          <Button
            variant="danger"
            leadingIcon={<LogOut />}
            disabled={!canLeave}
            onClick={() => setPending({ kind: 'leave' })}
          >
            {t('members.leave')}
          </Button>
          {leaveNote && <p className="text-sm text-mute">{leaveNote}</p>}
        </div>
      )}

      <Sheet open={!!menuFor} onOpenChange={(open) => !open && setMenuFor(null)}>
        {menuFor && (
          <SheetContent title={displayName(menuFor)} closeLabel={t('common.close')} size="sm">
            {menuFor.is_placeholder ? (
              <PlaceholderMenu
                group={group}
                member={menuFor}
                info={placeholders?.get(menuFor.id)}
                onEdit={() => {
                  setMenuFor(null)
                  setEditing(menuFor)
                }}
                onRemove={() => {
                  setMenuFor(null)
                  setPending({ kind: 'removePlaceholder', member: menuFor })
                }}
                onDone={() => setMenuFor(null)}
              />
            ) : (
              <MemberActions
                group={group}
                member={menuFor}
                onPick={(action) => {
                  setMenuFor(null)
                  setPending(action)
                }}
              />
            )}
          </SheetContent>
        )}
      </Sheet>

      {copy && (
        <ConfirmDialog
          open={!!pending}
          onOpenChange={(open) => !open && setPending(null)}
          title={copy.title}
          description={copy.description}
          confirmLabel={copy.confirm}
          cancelLabel={t('common.cancel')}
          closeLabel={t('common.close')}
          tone={copy.tone}
          onConfirm={() => run(pending!)}
        />
      )}

      {canInvite && !alone && (
        <InviteSheet group={group} open={inviteOpen} onOpenChange={setInviteOpen} />
      )}
      {canAddPeople(group) && (
        <AddPlaceholderSheet group={group} open={addOpen} onOpenChange={setAddOpen} />
      )}
      <EditPlaceholderSheet
        key={editing?.id ?? 'none'}
        member={editing}
        info={editing ? placeholders?.get(editing.id) : undefined}
        canChangeEmail={
          !!editing &&
          placeholderActions(group, editing, placeholders?.get(editing.id), viewerId).editEmail
        }
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </div>
  )
}
