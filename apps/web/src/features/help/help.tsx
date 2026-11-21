import { t, type en } from '@potluck/i18n'
import { HelpLink, HelpTip } from '@potluck/ui'
import { helpHref, type HelpTopic } from './topics'

/** A "?" that opens the guide at `topic` in a new tab. */
export function Help({
  topic,
  showLabel,
  align,
  className,
}: {
  topic: HelpTopic
  showLabel?: boolean
  align?: 'start' | 'end'
  className?: string
}) {
  return (
    <HelpLink
      href={helpHref(topic)}
      label={t(`help.topics.${topic}`)}
      newTabHint={t('help.newTab')}
      showLabel={showLabel}
      align={align}
      className={className}
    />
  )
}

type TipTopic = keyof typeof en.help.tips

/** A "?" that opens a short "Good to know" note, with the guide one tap further. */
export function GoodToKnow({
  topic,
  tip,
  text,
  align,
  onHero,
  className,
}: {
  topic: HelpTopic
  /** Which note to show. */
  tip?: Exclude<TipTopic, 'expenseList'>
  /** The note itself, for one whose wording takes values (pass the finished `t()` string). */
  text?: string
  align?: 'start' | 'end'
  /** Set on the balance hero. */
  onHero?: boolean
  className?: string
}) {
  return (
    <HelpTip
      onHero={onHero}
      label={t(`help.topics.${topic}`)}
      title={t('help.goodToKnow')}
      href={helpHref(topic)}
      readMoreLabel={t('help.readMore')}
      newTabHint={t('help.newTab')}
      align={align}
      className={className}
    >
      {text ?? (tip && t(`help.tips.${tip}`))}
    </HelpTip>
  )
}
