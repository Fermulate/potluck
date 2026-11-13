import {
  deleteGroup,
  groupKeys,
  updateGroup,
  type GroupDetail,
  type GroupSettingsPatch,
} from '@potluck/api'
import { can } from '@potluck/core'
import { t } from '@potluck/i18n'
import { Button, Card, ConfirmDialog, Field, Input, Skeleton, Switch, toast } from '@potluck/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Archive, ArchiveRestore, LogOut, Trash2 } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { GroupDataSection } from '@/features/export-import/group-data-section'
import { Help } from '@/features/help/help'
import { CurrencyField } from '@/features/me/profile-fields'
import { useUserId } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { DefaultSplitSection } from './default-split-section'
import { GroupTile } from './group-bits'
import { ColorPicker, EmojiPicker } from './group-form-fields'
import { useGroup } from './use-groups'

function Section({
  title,
  help,
  children,
}: {
  title: string
  help?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-mute">{title}</h3>
        {help}
      </div>
      {children}
    </section>
  )
}

function useGroupPatch(group: GroupDetail) {
  const queryClient = useQueryClient()
  const key = groupKeys.detail(group.id)
  return useMutation({
    mutationFn: (patch: GroupSettingsPatch) => updateGroup(supabase, group.id, patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<GroupDetail | null>(key)
      queryClient.setQueryData<GroupDetail | null>(key, (g) => (g ? { ...g, ...patch } : g))
      return { previous }
    },
    onError: (error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
      toast.error(errorMessage(error))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: groupKeys.all }),
  })
}

function DetailsForm({ group }: { group: GroupDetail }) {
  const patch = useGroupPatch(group)
  const [name, setName] = useState(group.name)
  const [emoji, setEmoji] = useState(group.emoji ?? '')
  const [color, setColor] = useState(group.color ?? 'saffron')
  const [currency, setCurrency] = useState(group.currency)
  const dirty =
    name.trim() !== group.name ||
    emoji !== (group.emoji ?? '') ||
    color !== (group.color ?? 'saffron') ||
    currency !== group.currency

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    const changes: GroupSettingsPatch = {}
    if (name.trim() !== group.name) changes.name = name.trim()
    if (emoji !== (group.emoji ?? '')) changes.emoji = emoji
    if (color !== (group.color ?? 'saffron')) changes.color = color
    if (currency !== group.currency) changes.currency = currency
    patch.mutate(changes, {
      onSuccess: () => toast.success(t('groups.settings.saved')),
      onError: () => setCurrency(group.currency),
    })
  }

  return (
    <form className="grid gap-5" onSubmit={onSubmit}>
      <div className="flex items-end gap-4">
        <GroupTile emoji={emoji} color={color} size="lg" />
        <Field label={t('groups.create.nameLabel')} className="flex-1">
          <Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <EmojiPicker value={emoji} onChange={setEmoji} />
      <ColorPicker value={color} onChange={setColor} />
      <CurrencyField
        label={t('groups.create.currencyLabel')}
        hint={t('groups.settings.currencyLocked')}
        value={currency}
        onChange={setCurrency}
      />
      <Button
        type="submit"
        className="justify-self-start"
        disabled={!dirty || !name.trim()}
        loading={patch.isPending}
      >
        {t('common.save')}
      </Button>
    </form>
  )
}

type Pending = 'delete' | null

export function GroupSettingsPage({ groupId }: { groupId: string }) {
  const { data: group, isPending } = useGroup(groupId)
  if (isPending || !group) {
    return (
      <div className="grid gap-4" aria-hidden>
        <Skeleton className="h-40" />
        <Skeleton className="h-24" />
      </div>
    )
  }
  return <SettingsBody group={group} />
}

function SettingsBody({ group }: { group: GroupDetail }) {
  const viewerId = useUserId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const patch = useGroupPatch(group)
  const [pending, setPending] = useState<Pending>(null)
  const editable = can(group.my_role, 'group.edit')
  const deletable = can(group.my_role, 'group.delete')
  const allSquare = group.members.every((m) => m.net_cents === 0)
  const me = group.members.find((m) => m.id === viewerId)

  async function removeGroup() {
    try {
      await deleteGroup(supabase, group.id)
      queryClient.removeQueries({ queryKey: groupKeys.detail(group.id) })
      await queryClient.invalidateQueries({ queryKey: groupKeys.all })
      toast.success(t('groups.settings.deleted', { group: group.name }))
      await navigate({ to: '/groups', replace: true })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  function toggleArchive() {
    const archived = !group.archived_at
    patch.mutate(
      { archived_at: archived ? new Date().toISOString() : null },
      {
        onSuccess: () =>
          toast.success(
            archived
              ? t('groups.settings.archived', { group: group.name })
              : t('groups.settings.unarchived', { group: group.name }),
            archived
              ? {
                  action: {
                    label: t('common.undo'),
                    onClick: () => patch.mutate({ archived_at: null }),
                  },
                }
              : undefined,
          ),
      },
    )
  }

  return (
    <div className="grid gap-8">
      <h2 className="font-display text-3xl">{t('groups.settings.title')}</h2>
      {!editable && (
        <p className="rounded-card bg-sunken p-4 text-sm text-mute">
          {t('groups.settings.readOnly')}
        </p>
      )}

      {editable && (
        <Section title={t('groups.settings.details')}>
          <Card padding="roomy">
            <DetailsForm key={group.updated_at} group={group} />
          </Card>
        </Section>
      )}

      <Section title={t('groups.settings.rules')} help={<Help topic="houseRules" />}>
        <Card padding="roomy" className="grid gap-5">
          <Switch
            label={t('groups.settings.simplifyDebts')}
            description={t('groups.settings.simplifyDebtsHint')}
            checked={group.simplify_debts}
            disabled={!editable}
            onCheckedChange={(checked) => patch.mutate({ simplify_debts: checked })}
          />
          <Switch
            label={t('groups.settings.membersCanInvite')}
            description={t('groups.settings.membersCanInviteHint')}
            checked={group.members_can_invite}
            disabled={!editable}
            onCheckedChange={(checked) => patch.mutate({ members_can_invite: checked })}
          />
        </Card>
      </Section>

      <DefaultSplitSection groupId={group.id} />

      <GroupDataSection groupId={group.id} archived={!!group.archived_at} />

      <Section title={t('groups.settings.danger')}>
        <Card padding="roomy" className="grid gap-5">
          {editable && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-sm text-sm text-mute">{t('groups.settings.archiveHint')}</p>
              <Button
                variant="secondary"
                leadingIcon={group.archived_at ? <ArchiveRestore /> : <Archive />}
                onClick={toggleArchive}
              >
                {group.archived_at ? t('groups.settings.unarchive') : t('groups.settings.archive')}
              </Button>
            </div>
          )}
          {me && me.role !== 'owner' && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-sm text-sm text-mute">
                {me.net_cents !== 0
                  ? t('groups.settings.leaveBlocked')
                  : t('groups.settings.leaveConfirm', { group: group.name })}
              </p>
              <Button asChild variant="secondary">
                <Link to="/groups/$groupId/members" params={{ groupId: group.id }}>
                  <LogOut aria-hidden className="-ml-1 size-4" />
                  {t('groups.settings.leave')}
                </Link>
              </Button>
            </div>
          )}
          {deletable && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-sm text-sm text-mute">
                {allSquare
                  ? t('groups.settings.deleteConfirm', { group: group.name })
                  : t('groups.settings.deleteBlocked')}
              </p>
              <Button
                variant="danger"
                leadingIcon={<Trash2 />}
                disabled={!allSquare}
                onClick={() => setPending('delete')}
              >
                {t('groups.settings.delete')}
              </Button>
            </div>
          )}
        </Card>
      </Section>

      <ConfirmDialog
        open={pending === 'delete'}
        onOpenChange={(open) => !open && setPending(null)}
        title={t('groups.settings.delete')}
        description={t('groups.settings.deleteConfirm', { group: group.name })}
        confirmLabel={t('groups.settings.delete')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        tone="danger"
        onConfirm={removeGroup}
      />
    </div>
  )
}
