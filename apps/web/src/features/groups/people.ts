import type { GroupDetail, GroupMember, PersonSummary } from '@potluck/api'
import { t } from '@potluck/i18n'
import type { AvatarStackPerson } from '@potluck/ui'
import { avatarSrc } from '@/lib/queries'

export function displayName(person: Pick<PersonSummary, 'display_name' | 'deleted_at'>): string {
  return person.deleted_at ? t('members.formerMember') : person.display_name
}

export function firstName(person: Pick<PersonSummary, 'display_name' | 'deleted_at'>): string {
  return displayName(person).split(/\s+/)[0] ?? ''
}

export function stackPeople(members: PersonSummary[]): AvatarStackPerson[] {
  return members.map((m) => ({ id: m.id, name: displayName(m), src: avatarSrc(m.avatar_path) }))
}

/** The other person in a 1:1 group. */
export function directFriend(group: GroupDetail, viewerId: string): GroupMember | undefined {
  return group.members.find((m) => m.id !== viewerId)
}

/** View transition name shared by a group card's tile and the group header's tile. */
export function groupTransitionName(groupId: string): string {
  return `group-tile-${groupId}`
}
