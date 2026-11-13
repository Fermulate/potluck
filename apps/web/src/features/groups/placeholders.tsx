import {
  addPlaceholderMember,
  groupKeys,
  peopleKeys,
  remindPlaceholder,
  updatePlaceholder,
  type GroupDetail,
  type GroupMember,
  type Placeholder,
} from '@potluck/api'
import { placeholderSchema } from '@potluck/core'
import { t } from '@potluck/i18n'
import { Avatar, Button, Field, Input, Sheet, SheetContent, toast } from '@potluck/ui'
import { useQueryClient } from '@tanstack/react-query'
import { BellRing, Pencil, Plus, Share2, UserMinus } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Help } from '@/features/help/help'
import { useUserId } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { useViewerTimezone } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { placeholderActions, placeholderLine, shareClaimLink } from './placeholder-helpers'

/** The dashed "empty chair" row at the end of the member list. */
export function AddSeatRow({ onClick }: { onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 rounded-card border border-dashed border-line-strong p-3 text-left transition-colors hover:border-ink/40 hover:bg-sunken/60"
      >
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full border border-dashed border-line-strong text-mute"
        >
          <Plus className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{t('people.placeholder.add')}</span>
          <span className="block text-sm text-mute">{t('people.placeholder.badge')}</span>
        </span>
      </button>
    </li>
  )
}

const ADD_FORM = 'add-placeholder-form'

/** Add someone by name (and maybe email): they are in the group and can be split with at once. */
export function AddPlaceholderSheet({
  group,
  open,
  onOpenChange,
}: {
  group: GroupDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = placeholderSchema.safeParse({ display_name: name, email })
    if (!parsed.success) {
      setEmailError(name.trim() ? t('errors.validation.invalidEmail') : null)
      return
    }
    setBusy(true)
    try {
      await addPlaceholderMember(supabase, {
        groupId: group.id,
        displayName: parsed.data.display_name,
        email: parsed.data.email,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: groupKeys.all }),
        queryClient.invalidateQueries({ queryKey: peopleKeys.placeholders(group.id) }),
        queryClient.invalidateQueries({ queryKey: ['potluck', 'money'] }),
      ])
      toast.success(
        parsed.data.email
          ? t('people.placeholder.addedInvited', { name: parsed.data.display_name })
          : t('people.placeholder.added', { name: parsed.data.display_name }),
      )
      setName('')
      setEmail('')
      setEmailError(null)
      onOpenChange(false)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={t('people.placeholder.addTitle')}
        description={t('people.placeholder.addBody')}
        closeLabel={t('common.close')}
        size="sm"
        footer={
          <Button
            type="submit"
            form={ADD_FORM}
            block
            size="lg"
            loading={busy}
            disabled={!name.trim()}
          >
            {t('people.placeholder.submit', { group: group.name })}
          </Button>
        }
      >
        <form id={ADD_FORM} className="grid gap-5 pt-2" onSubmit={onSubmit} noValidate>
          <div className="flex items-end gap-3">
            <Avatar
              name={name.trim() || '?'}
              seed={name.trim() || 'new'}
              size="md"
              className="opacity-80"
            />
            <Field label={t('people.placeholder.nameLabel')} className="flex-1">
              <Input
                required
                autoFocus
                maxLength={80}
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('people.placeholder.namePlaceholder')}
              />
            </Field>
          </div>
          <Field
            label={t('people.placeholder.emailLabel')}
            hint={t('people.placeholder.emailHint')}
            error={emailError ?? undefined}
          >
            <Input
              type="email"
              inputMode="email"
              autoComplete="off"
              maxLength={254}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setEmailError(null)
              }}
              placeholder={t('people.placeholder.emailPlaceholder')}
            />
          </Field>
          <Help topic="placeholders" showLabel className="justify-self-start" />
        </form>
      </SheetContent>
    </Sheet>
  )
}

const EDIT_FORM = 'edit-placeholder-form'

/** Rename a placeholder, or change (or clear) where its invite goes. */
export function EditPlaceholderSheet({
  member,
  info,
  onOpenChange,
}: {
  member: GroupMember | null
  info: Placeholder | undefined
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(member?.display_name ?? '')
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!member) return
    const parsed = placeholderSchema.safeParse({ display_name: name, email })
    if (!parsed.success) {
      setEmailError(name.trim() ? t('errors.validation.invalidEmail') : null)
      return
    }
    const newName = parsed.data.display_name !== member.display_name
    const newEmail = parsed.data.email ?? undefined
    setBusy(true)
    try {
      await updatePlaceholder(supabase, member.id, {
        ...(newName ? { displayName: parsed.data.display_name } : {}),
        ...(newEmail ? { email: newEmail } : {}),
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: groupKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['potluck', 'people'] }),
        queryClient.invalidateQueries({ queryKey: ['potluck', 'money'] }),
      ])
      toast.success(newEmail ? t('people.placeholder.savedInvited') : t('people.placeholder.saved'))
      onOpenChange(false)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={!!member} onOpenChange={onOpenChange}>
      {member && (
        <SheetContent
          title={t('people.placeholder.editTitle', { name: member.display_name })}
          description={t('people.placeholder.editBody')}
          closeLabel={t('common.close')}
          size="sm"
          footer={
            <Button
              type="submit"
              form={EDIT_FORM}
              block
              size="lg"
              loading={busy}
              disabled={!name.trim()}
            >
              {t('people.placeholder.save')}
            </Button>
          }
        >
          <form id={EDIT_FORM} className="grid gap-5 pt-2" onSubmit={onSubmit} noValidate>
            <Field label={t('people.placeholder.nameLabel')}>
              <Input
                required
                maxLength={80}
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field
              label={t('people.placeholder.emailLabel')}
              hint={
                info?.email_hint
                  ? t('people.placeholder.waitingFor', { email: info.email_hint })
                  : t('people.placeholder.emailHint')
              }
              error={emailError ?? undefined}
            >
              <Input
                type="email"
                inputMode="email"
                autoComplete="off"
                maxLength={254}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setEmailError(null)
                }}
                placeholder={info?.email_hint ?? t('people.placeholder.emailPlaceholder')}
              />
            </Field>
          </form>
        </SheetContent>
      )}
    </Sheet>
  )
}

function MenuRow({
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

/** The menu for someone not on Potluck yet: share their link, remind, edit, remove. */
export function PlaceholderMenu({
  group,
  member,
  info,
  onEdit,
  onRemove,
  onDone,
}: {
  group: GroupDetail
  member: GroupMember
  info: Placeholder | undefined
  onEdit: () => void
  onRemove: () => void
  onDone: () => void
}) {
  const viewerId = useUserId()
  const timeZone = useViewerTimezone()
  const queryClient = useQueryClient()
  const [reminding, setReminding] = useState(false)
  const allowed = placeholderActions(group, member, info, viewerId)
  const name = member.display_name

  async function remind() {
    setReminding(true)
    try {
      await remindPlaceholder(supabase, member.id)
      await queryClient.invalidateQueries({ queryKey: peopleKeys.placeholders(group.id) })
      toast.success(t('people.placeholder.reminded'))
      onDone()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setReminding(false)
    }
  }

  return (
    <div className="grid gap-1">
      <p className="px-3 pb-2 text-sm text-pretty text-mute">
        {t('people.placeholder.menuHint')} {placeholderLine(info, timeZone)}.
      </p>
      {allowed.share && (
        <MenuRow
          icon={<Share2 />}
          label={t('people.placeholder.shareLink')}
          onClick={() => {
            void shareClaimLink(name, group.name, info!.claim_code!)
            onDone()
          }}
        />
      )}
      {allowed.remind && (
        <MenuRow
          icon={<BellRing />}
          label={t('people.placeholder.remind')}
          hint={t('people.placeholder.remindHint')}
          disabled={reminding}
          onClick={() => void remind()}
        />
      )}
      {allowed.edit && (
        <MenuRow icon={<Pencil />} label={t('people.placeholder.edit')} onClick={onEdit} />
      )}
      {allowed.remove && (
        <MenuRow
          danger
          icon={<UserMinus />}
          label={t('people.placeholder.remove', { name })}
          hint={allowed.removable ? undefined : t('members.removeBlocked', { name })}
          disabled={!allowed.removable}
          onClick={onRemove}
        />
      )}
    </div>
  )
}
