import {
  groupPlaceholdersQueryOptions,
  type GroupDetail,
  type GroupMember,
  type Placeholder,
} from '@potluck/api'
import { can } from '@potluck/core'
import { formatDate, t } from '@potluck/i18n'
import { toast } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { copyText } from '@/features/invites/share'
import { inviteUrl } from '@/lib/app-url'
import { supabase } from '@/lib/supabase'

/** Placeholders of a group (ADR 19) with what the viewer may see of their invites. */
export function usePlaceholders(groupId: string) {
  return useQuery(groupPlaceholdersQueryOptions(supabase, groupId))
}

/** May the viewer add people to this group by name? Same rule as `add_placeholder_member`. */
export function canAddPeople(group: GroupDetail): boolean {
  return (
    !group.is_direct &&
    !group.archived_at &&
    can(group.my_role, 'placeholder.add', { membersCanInvite: group.members_can_invite })
  )
}

/** Shares a placeholder's claim link: the native share sheet, or the clipboard. */
export async function shareClaimLink(name: string, group: string, code: string) {
  const url = inviteUrl(code)
  const data = {
    title: t('people.placeholder.shareTitle', { group }),
    text: t('people.placeholder.shareText', { name, group, url }),
    url,
  }
  if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share(data)
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }
  if (await copyText(url)) toast.success(t('people.placeholder.linkCopied', { name }))
}

/** The line under a placeholder's name: where their invite goes and when it went. */
export function placeholderLine(info: Placeholder | undefined, timeZone: string): string {
  if (!info?.email_hint) return t('people.placeholder.noEmail')
  if (info.reminded_at) {
    return t('people.placeholder.remindedOn', {
      date: formatDate(info.reminded_at, { timeZone, style: 'dayMonth' }),
    })
  }
  return t('people.placeholder.waitingFor', { email: info.email_hint })
}

/** What `viewerId` may do to a placeholder, from `can()`. */
export function placeholderActions(
  group: GroupDetail,
  member: GroupMember,
  info: Placeholder | undefined,
  viewerId: string,
) {
  const open = !group.archived_at
  const isCreator = !!info && info.created_by === viewerId
  return {
    share: open && !!info?.claim_code,
    remind: open && !!info?.email_hint && !info.reminded_at,
    edit:
      open &&
      can(group.my_role, 'placeholder.edit', {
        membersCanInvite: group.members_can_invite,
        isCreator,
      }),
    /** Where the invite goes: whoever added them or an admin (`update_placeholder`). */
    editEmail: open && (isCreator || group.my_role === 'owner' || group.my_role === 'admin'),
    remove: open && can(group.my_role, 'placeholder.remove', { netCents: 0, isCreator }),
    removable:
      open && can(group.my_role, 'placeholder.remove', { netCents: member.net_cents, isCreator }),
  }
}
