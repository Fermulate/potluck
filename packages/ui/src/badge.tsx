import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn'

export type BadgeTone = 'neutral' | 'tomato' | 'saffron' | 'olive' | 'plum' | 'ink'

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-sunken text-mute',
  tomato: 'bg-tomato-soft text-tomato-ink',
  saffron: 'bg-saffron-soft text-saffron-ink',
  olive: 'bg-olive-soft text-olive-ink',
  plum: 'bg-plum-soft text-plum-ink',
  ink: 'bg-ink text-paper',
}

const dotTones: Record<BadgeTone, string> = {
  neutral: 'bg-mute',
  tomato: 'bg-tomato',
  saffron: 'bg-saffron',
  olive: 'bg-olive',
  plum: 'bg-plum',
  ink: 'bg-paper',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  /** Leading status dot. */
  dot?: boolean
  icon?: ReactNode
}

/** Small, non-interactive status label. */
export function Badge({ tone = 'neutral', dot, icon, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-pill px-2.5 text-xs font-semibold whitespace-nowrap [&_svg]:size-3.5',
        badgeTones[tone],
        className,
      )}
      {...props}
    >
      {dot && <span aria-hidden className={cn('size-1.5 rounded-full', dotTones[tone])} />}
      {icon && (
        <span aria-hidden className="-ml-0.5 inline-flex">
          {icon}
        </span>
      )}
      {children}
    </span>
  )
}

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Toggled state; announced with aria-pressed. */
  selected?: boolean
  icon?: ReactNode
}

/** Interactive pill for filters and quick picks. */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected = false, icon, className, type = 'button', children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-pill border px-3.5 text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97] [&_svg]:size-4',
        selected
          ? 'border-ink bg-ink text-paper'
          : 'border-line-strong bg-card text-ink hover:border-ink/40',
        className,
      )}
      {...props}
    >
      {icon && (
        <span aria-hidden className="-ml-0.5 inline-flex">
          {icon}
        </span>
      )}
      {children}
    </button>
  )
})
