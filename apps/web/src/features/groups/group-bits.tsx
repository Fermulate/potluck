import type { GroupDetail, GroupMember, PersonSummary } from '@potluck/api'
import { formatMoney, t } from '@potluck/i18n'
import { Amount, cn, type AvatarStackPerson } from '@potluck/ui'
import type { CSSProperties } from 'react'
import { avatarSrc } from '@/lib/queries'
import { DEFAULT_GROUP_EMOJI, groupTone } from '@/lib/group-colors'

const tileSizes = {
  sm: 'size-10 rounded-[0.75rem] text-xl',
  md: 'size-14 rounded-[1rem] text-[1.75rem]',
  lg: 'size-[4.5rem] rounded-[1.25rem] text-[2.5rem]',
  xl: 'size-28 rounded-[1.75rem] text-[4rem]',
} as const

/** The group's emoji on a tilted tile in its color. */
export function GroupTile({
  emoji,
  color,
  size = 'md',
  tilt = true,
  className,
  style,
}: {
  emoji: string | null
  color: string | null
  size?: keyof typeof tileSizes
  tilt?: boolean
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        'grid shrink-0 place-items-center leading-none select-none',
        tileSizes[size],
        groupTone(color).soft,
        tilt && 'rotate-[-4deg]',
        className,
      )}
    >
      {emoji || DEFAULT_GROUP_EMOJI}
    </span>
  )
}

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

/** "you are owed $12.00" / "you owe $4.50" / "settled up", colored by sign. */
export function ViewerBalance({
  cents,
  currency,
  className,
}: {
  cents: number
  currency: string
  className?: string
}) {
  if (cents === 0) {
    return <span className={cn('text-sm text-mute', className)}>{t('groups.settledUp')}</span>
  }
  const amount = formatMoney(Math.abs(cents), currency)
  const text = cents > 0 ? t('groups.youAreOwed', { amount }) : t('groups.youOwe', { amount })
  const [before, after] = text.split(amount) as [string, string | undefined]
  return (
    <span className={cn('text-sm', className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        <span className="text-mute">{before}</span>
        <Amount
          cents={Math.abs(cents)}
          currency={currency}
          tone={cents > 0 ? 'owed' : 'owe'}
          className="font-bold"
        />
        {after && <span className="text-mute">{after}</span>}
      </span>
    </span>
  )
}

/** View transition name shared by a group card's tile and the group header's tile. */
export function groupTransitionName(groupId: string): string {
  return `group-tile-${groupId}`
}
