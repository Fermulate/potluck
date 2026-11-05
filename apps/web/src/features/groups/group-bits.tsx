import { DEFAULT_LOCALE, formatMoney, t } from '@potluck/i18n'
import { Amount, cn } from '@potluck/ui'
import type { CSSProperties } from 'react'
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

/** "you are owed $12.00" / "you owe $4.50" / "settled up", colored by sign. */
export function ViewerBalance({
  cents,
  currency,
  stacked = false,
  sentence = false,
  className,
}: {
  cents: number
  currency: string
  /** Label over a bigger amount, for cards. */
  stacked?: boolean
  /** Reads as a standalone sentence (the group header), not a fragment under a name. */
  sentence?: boolean
  className?: string
}) {
  if (cents === 0) {
    return (
      <span
        className={cn(
          'text-sm font-medium',
          sentence ? 'text-olive-ink' : 'text-mute',
          stacked && 'pt-1',
          className,
        )}
      >
        {sentence ? t('groups.header.settled') : t('groups.settledUp')}
      </span>
    )
  }
  const amount = formatMoney(Math.abs(cents), currency)
  const text = sentence
    ? cents > 0
      ? t('groups.header.youAreOwed', { amount })
      : t('groups.header.youOwe', { amount })
    : cents > 0
      ? t('groups.youAreOwed', { amount })
      : t('groups.youOwe', { amount })
  const [before, after] = text.split(amount) as [string, string | undefined]
  const figure = (
    <Amount
      cents={Math.abs(cents)}
      currency={currency}
      locale={DEFAULT_LOCALE}
      tone={cents > 0 ? 'owed' : 'owe'}
      className={stacked ? 'text-xl font-extrabold' : 'font-bold'}
    />
  )
  return (
    <span className={cn(stacked ? 'flex flex-col items-end text-right' : 'text-sm', className)}>
      <span className="sr-only">{text}</span>
      {stacked ? (
        <>
          <span aria-hidden className="text-xs font-medium text-mute">
            {before.trim()}
          </span>
          <span aria-hidden>{figure}</span>
        </>
      ) : (
        <span aria-hidden>
          <span className="text-mute">{before}</span>
          {figure}
          {after && <span className="text-mute">{after}</span>}
        </span>
      )}
    </span>
  )
}
