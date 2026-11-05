import { Slot } from '@radix-ui/react-slot'
import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from './cn'

export type CardTone = 'default' | 'sunken' | 'hero' | 'saffron' | 'ghost'

const tones: Record<CardTone, string> = {
  default: 'border border-line bg-card text-ink',
  sunken: 'bg-sunken text-ink',
  hero: 'on-hero',
  saffron: 'bg-saffron text-on-saffron',
  ghost: 'border border-dashed border-line-strong text-ink',
}

const paddings = {
  none: '',
  tight: 'p-3',
  default: 'p-4',
  roomy: 'p-5 sm:p-6',
} as const

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: CardTone
  padding?: keyof typeof paddings
  /** Adds hover and press feedback. Use with `asChild` around a link or button. */
  interactive?: boolean
  /** Render the child element (a link, a button, a section) with card styles. */
  asChild?: boolean
}

/** Surface with an 18px radius. Borders over shadows. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { tone = 'default', padding = 'default', interactive, asChild, className, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp
      ref={ref}
      className={cn(
        'relative block rounded-card',
        tones[tone],
        paddings[padding],
        interactive &&
          'cursor-pointer text-left transition-[transform,border-color,background-color] duration-150 ease-out hover:border-line-strong active:scale-[0.99]',
        className,
      )}
      {...props}
    />
  )
})
