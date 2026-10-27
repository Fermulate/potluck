import {
  createInvite,
  groupInvitesQueryOptions,
  groupKeys,
  restoreInvite,
  revokeInvite,
  type GroupDetail,
  type GroupInviteRow,
} from '@potluck/api'
import { can } from '@potluck/core'
import { formatDate, t } from '@potluck/i18n'
import {
  Button,
  cn,
  IconButton,
  SegmentedControl,
  Sheet,
  SheetContent,
  Skeleton,
  toast,
} from '@potluck/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Copy, Link2, Share2, X } from 'lucide-react'
import { useState } from 'react'
import { inviteUrl } from '@/lib/app-url'
import { errorMessage } from '@/lib/errors'
import { useViewerTimezone } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { copyText, shareInvite } from './share'

type UsesChoice = '1' | '5' | '25' | 'unlimited'
type ExpiryChoice = '1' | '7' | '30' | 'never'

const DAY = 24 * 60 * 60 * 1000

function inviteMeta(invite: GroupInviteRow, timeZone: string): string {
  return [
    invite.role === 'admin' ? t('invites.adminLink') : null,
    invite.max_uses
      ? t('invites.usesLeft', { count: Math.max(0, invite.max_uses - invite.uses) })
      : t('invites.unlimited'),
    invite.expires_at
      ? t('invites.expiresOn', {
          date: formatDate(invite.expires_at, { timeZone, style: 'dayMonth' }),
        })
      : null,
    invite.uses > 0 ? t('invites.used', { count: invite.uses }) : null,
  ]
    .filter(Boolean)
    .join(', ')
}

function InviteRow({
  invite,
  fresh,
  groupName,
  onRevoke,
}: {
  invite: GroupInviteRow
  fresh: boolean
  groupName: string
  onRevoke: () => void
}) {
  const timeZone = useViewerTimezone()
  const [copied, setCopied] = useState(false)
  const url = inviteUrl(invite.code)

  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded-card border bg-card p-3 transition-colors duration-500',
        fresh ? 'border-saffron bg-saffron-soft/50' : 'border-line',
      )}
    >
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-full bg-saffron-soft text-saffron-ink"
      >
        <Link2 className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{url.replace(/^https?:\/\//, '')}</p>
        <p className="truncate text-xs text-mute">{inviteMeta(invite, timeZone)}</p>
      </div>
      <IconButton
        size="sm"
        variant="ghost"
        label={copied ? t('common.copied') : t('invites.copyLink')}
        icon={copied ? <Check /> : <Copy />}
        onClick={async () => {
          if (await copyText(url)) {
            setCopied(true)
            toast.success(t('invites.linkCopied'))
            window.setTimeout(() => setCopied(false), 1600)
          }
        }}
      />
      <IconButton
        size="sm"
        variant="ghost"
        label={t('common.share')}
        icon={<Share2 />}
        onClick={() => void shareInvite(groupName, invite.code)}
      />
      <IconButton
        size="sm"
        variant="ghost"
        label={t('invites.revokeLink', { code: invite.code })}
        icon={<X />}
        onClick={onRevoke}
      />
    </li>
  )
}

/** Create, share and revoke invite links for one group. */
export function InvitePanel({
  group,
  intro = true,
}: {
  group: GroupDetail
  /** Show the one-line explainer before the first link exists. Off when the host page has its own. */
  intro?: boolean
}) {
  const queryClient = useQueryClient()
  const invites = useQuery(groupInvitesQueryOptions(supabase, group.id))
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const [uses, setUses] = useState<UsesChoice>('unlimited')
  const [expiry, setExpiry] = useState<ExpiryChoice>('7')
  const [fresh, setFresh] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const canAdminInvite = can(group.my_role, 'invite.create', {
    membersCanInvite: group.members_can_invite,
    inviteRole: 'admin',
  })
  const canInvite = can(group.my_role, 'invite.create', {
    membersCanInvite: group.members_can_invite,
    inviteRole: 'member',
  })
  const key = groupKeys.invites(group.id)

  const create = useMutation({
    mutationFn: () =>
      createInvite(supabase, {
        groupId: group.id,
        role: canAdminInvite ? role : 'member',
        maxUses: uses === 'unlimited' ? null : Number(uses),
        expiresAt:
          expiry === 'never' ? null : new Date(Date.now() + Number(expiry) * DAY).toISOString(),
      }),
    onSuccess: (invite) => {
      queryClient.setQueryData<GroupInviteRow[]>(key, (rows) => [invite, ...(rows ?? [])])
      setFresh(invite.id)
      toast.success(t('invites.created'))
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const revoke = useMutation({
    mutationFn: (invite: GroupInviteRow) => revokeInvite(supabase, invite.id),
    onMutate: async (invite) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<GroupInviteRow[]>(key)
      queryClient.setQueryData<GroupInviteRow[]>(key, (rows) =>
        rows?.filter((r) => r.id !== invite.id),
      )
      return { previous }
    },
    onError: (error, _invite, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
      toast.error(errorMessage(error))
    },
    onSuccess: (_data, invite) => {
      toast(t('invites.revoked'), {
        action: {
          label: t('common.undo'),
          onClick: async () => {
            try {
              await restoreInvite(supabase, invite.id)
            } catch (error) {
              toast.error(errorMessage(error))
            }
            void queryClient.invalidateQueries({ queryKey: key })
          },
        },
      })
    },
  })

  if (group.is_direct) return null
  if (!canInvite) {
    return (
      <p className="rounded-card bg-sunken p-4 text-sm text-mute">{t('invites.noPermission')}</p>
    )
  }

  const open = invites.data ?? []
  const latest = open[0]
  const others = open.slice(1)
  const kind = canAdminInvite && role === 'admin' ? 'admin' : 'member'
  const summary = t('invites.summary.line', {
    kind: t(`invites.summary.${kind}`),
    uses:
      uses === 'unlimited'
        ? t('invites.summary.usesAny')
        : t('invites.summary.uses', { count: Number(uses) }),
    expiry:
      expiry === 'never'
        ? t('invites.summary.expiresNever')
        : t('invites.summary.expires', { count: Number(expiry) }),
  })
  const settingsId = `invite-settings-${group.id}`

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      {invites.isPending ? (
        <Skeleton className="h-32" />
      ) : latest ? (
        <LatestLink
          invite={latest}
          fresh={latest.id === fresh}
          groupName={group.name}
          onRevoke={() => revoke.mutate(latest)}
        />
      ) : intro ? (
        <p className="text-pretty text-mute">{t('invites.intro', { group: group.name })}</p>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-card border border-line bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="pt-1.5 text-sm text-mute">{summary}</p>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showSettings}
            aria-controls={settingsId}
            trailingIcon={
              <ChevronDown
                className={cn('transition-transform duration-200', showSettings && 'rotate-180')}
              />
            }
            onClick={() => setShowSettings((v) => !v)}
            className="shrink-0"
          >
            {showSettings ? t('invites.hideSettings') : t('invites.settings')}
          </Button>
        </div>
        {showSettings && (
          <div id={settingsId} className="grid grid-cols-[minmax(0,1fr)] gap-4 pb-1">
            {canAdminInvite && (
              <div className="grid gap-1.5">
                <span className="text-sm font-semibold">{t('invites.roleLabel')}</span>
                <SegmentedControl
                  block
                  label={t('invites.roleLabel')}
                  value={role}
                  onValueChange={setRole}
                  options={[
                    { value: 'member', label: t('roles.member.label') },
                    { value: 'admin', label: t('roles.admin.label') },
                  ]}
                />
              </div>
            )}
            <div className="grid gap-1.5">
              <span className="text-sm font-semibold">{t('invites.maxUsesLabel')}</span>
              <SegmentedControl
                block
                size="sm"
                label={t('invites.maxUsesLabel')}
                value={uses}
                onValueChange={setUses}
                options={[
                  { value: '1', label: t('invites.uses.one') },
                  { value: '5', label: t('invites.uses.five') },
                  { value: '25', label: t('invites.uses.many') },
                  { value: 'unlimited', label: t('invites.unlimited') },
                ]}
              />
            </div>
            <div className="grid gap-1.5">
              <span className="text-sm font-semibold">{t('invites.expiresLabel')}</span>
              <SegmentedControl
                block
                size="sm"
                label={t('invites.expiresLabel')}
                value={expiry}
                onValueChange={setExpiry}
                options={[
                  { value: '1', label: t('invites.expiry.day') },
                  { value: '7', label: t('invites.expiry.week') },
                  { value: '30', label: t('invites.expiry.month') },
                  { value: 'never', label: t('invites.never') },
                ]}
              />
            </div>
          </div>
        )}
        <Button
          block
          size={latest ? 'md' : 'lg'}
          variant={latest ? 'secondary' : 'primary'}
          leadingIcon={<Link2 />}
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          {latest ? t('invites.newLink') : t('invites.create')}
        </Button>
      </div>

      {others.length > 0 && (
        <section aria-labelledby={`invites-${group.id}`} className="flex min-w-0 flex-col gap-3">
          <h3 id={`invites-${group.id}`} className="text-sm font-bold text-mute">
            {t('invites.active')}
          </h3>
          <ul className="flex flex-col gap-2">
            {others.map((invite) => (
              <InviteRow
                key={invite.id}
                invite={invite}
                fresh={invite.id === fresh}
                groupName={group.name}
                onRevoke={() => revoke.mutate(invite)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** The newest open link, front and center: the thing people came here to copy. */
function LatestLink({
  invite,
  fresh,
  groupName,
  onRevoke,
}: {
  invite: GroupInviteRow
  fresh: boolean
  groupName: string
  onRevoke: () => void
}) {
  const timeZone = useViewerTimezone()
  const [copied, setCopied] = useState(false)
  const url = inviteUrl(invite.code)
  return (
    <section
      aria-label={t('invites.latest')}
      className={cn(
        'grid grid-cols-[minmax(0,1fr)] gap-3 rounded-card border p-4 transition-colors duration-500',
        fresh ? 'border-saffron bg-saffron-soft/60' : 'border-line bg-card',
      )}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-saffron-soft text-saffron-ink"
        >
          <Link2 className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{url.replace(/^https?:\/\//, '')}</p>
          <p className="truncate text-xs text-mute">{inviteMeta(invite, timeZone)}</p>
        </div>
        <IconButton
          size="sm"
          variant="ghost"
          label={t('invites.revokeLink', { code: invite.code })}
          icon={<X />}
          onClick={onRevoke}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="lg"
          leadingIcon={copied ? <Check /> : <Copy />}
          onClick={async () => {
            if (await copyText(url)) {
              setCopied(true)
              toast.success(t('invites.linkCopied'))
              window.setTimeout(() => setCopied(false), 1600)
            }
          }}
        >
          {copied ? t('common.copied') : t('invites.copyLink')}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          leadingIcon={<Share2 />}
          onClick={() => void shareInvite(groupName, invite.code)}
        >
          {t('common.share')}
        </Button>
      </div>
    </section>
  )
}

export function InviteSheet({
  group,
  open,
  onOpenChange,
}: {
  group: GroupDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={t('invites.title')}
        description={group.name}
        closeLabel={t('common.close')}
      >
        <div className="pt-2">
          <InvitePanel group={group} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
