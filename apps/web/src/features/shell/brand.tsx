import { t } from '@potluck/i18n'
import { cn } from '@potluck/ui'

/** The pot: a tomato bowl with a saffron lid knob and two wisps of steam. */
export function PotMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-7 shrink-0', className)}>
      <path
        d="M12 3.5c-1.6 1.6 1.6 3.2 0 4.8M18 3.5c-1.6 1.6 1.6 3.2 0 4.8"
        fill="none"
        stroke="var(--pl-mute)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="16" cy="11.4" r="1.8" fill="var(--pl-saffron)" />
      <path d="M4 14h24c0 7.2-5.4 13-12 13S4 21.2 4 14Z" fill="var(--pl-tomato)" />
      <path d="M3 14h26" stroke="var(--pl-ink)" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M9.5 18.5c1 2.6 3.3 4.4 6.5 4.6"
        fill="none"
        stroke="var(--pl-on-tomato)"
        strokeOpacity="0.55"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Wordmark({ className, size = 'md' }: { className?: string; size?: 'md' | 'lg' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 font-display leading-none text-ink',
        size === 'lg' ? 'text-4xl' : 'text-[1.75rem]',
        className,
      )}
    >
      <PotMark className={size === 'lg' ? 'size-9' : undefined} />
      <span className="-mb-0.5">{t('app.name')}</span>
    </span>
  )
}
