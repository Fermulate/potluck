import { avatarColor } from '@potluck/tokens'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { motion } from 'motion/react'
import { forwardRef } from 'react'
import { cn } from './cn'
import { usePrefersReducedMotion } from './hooks'

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const sizes: Record<AvatarSize, string> = {
  xs: 'size-6 text-[0.625rem]',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-14 text-lg',
  xl: 'size-20 text-2xl',
}

/** Up to two initials, Unicode safe. "Maya Lopez" -> "ML", "theo" -> "T". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = Array.from(words[0]!)[0] ?? ''
  const last = words.length > 1 ? (Array.from(words[words.length - 1]!)[0] ?? '') : ''
  return (first + last).toLocaleUpperCase()
}

export interface AvatarProps {
  name: string
  /** Stable id used to pick the fallback color. Defaults to the name. */
  seed?: string
  src?: string | null
  size?: AvatarSize
  /** Adds a ring in the page color, for overlapping stacks. */
  ring?: boolean
  className?: string
}

export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { name, seed, src, size = 'md', ring, className },
  ref,
) {
  const color = avatarColor(seed ?? name)
  return (
    <AvatarPrimitive.Root
      ref={ref}
      className={cn(
        'relative inline-flex shrink-0 overflow-hidden rounded-full align-middle select-none',
        sizes[size],
        ring && 'ring-2 ring-[var(--avatar-ring,var(--pl-paper))]',
        className,
      )}
    >
      {src && <AvatarPrimitive.Image src={src} alt={name} className="size-full object-cover" />}
      <AvatarPrimitive.Fallback
        delayMs={src ? 400 : undefined}
        className="grid size-full place-items-center rounded-full leading-none font-bold tracking-tight shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--pl-ink)_14%,transparent)]"
        style={{ backgroundColor: color.bg, color: color.fg }}
      >
        <span role="img" aria-label={name}>
          <span aria-hidden>{size === 'xs' ? Array.from(initials(name))[0] : initials(name)}</span>
        </span>
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
})

export interface AvatarStackPerson {
  id: string
  name: string
  src?: string | null
}

export interface AvatarStackProps {
  people: AvatarStackPerson[]
  /** How many faces to show before the "+n" counter. */
  max?: number
  size?: AvatarSize
  /** Accessible summary, e.g. "Maya, Theo and 4 others". */
  label?: string
  /** Animate faces in with a small stagger (invite page, joins). */
  animate?: boolean
  className?: string
}

const overlap: Record<AvatarSize, string> = {
  xs: '-ml-1.5',
  sm: '-ml-1.5',
  md: '-ml-2',
  lg: '-ml-4',
  xl: '-ml-6',
}

export function AvatarStack({
  people,
  max = 4,
  size = 'sm',
  label,
  animate = false,
  className,
}: AvatarStackProps) {
  const reduced = usePrefersReducedMotion()
  const shown = people.slice(0, max)
  const extra = people.length - shown.length
  return (
    <div
      role={label ? 'group' : undefined}
      aria-label={label}
      className={cn('flex items-center', className)}
    >
      {shown.map((p, i) => (
        <motion.span
          key={p.id}
          className={cn('inline-flex', i > 0 && overlap[size])}
          style={{ zIndex: shown.length - i }}
          initial={animate ? (reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, x: -8 }) : false}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          transition={
            reduced
              ? { duration: 0.2 }
              : { type: 'spring', stiffness: 380, damping: 26, delay: animate ? i * 0.06 : 0 }
          }
        >
          <Avatar name={p.name} seed={p.id} src={p.src} size={size} ring />
        </motion.span>
      ))}
      {extra > 0 && (
        <span
          className={cn(
            'relative inline-grid place-items-center rounded-full bg-sunken font-semibold text-mute tabular ring-2 ring-[var(--avatar-ring,var(--pl-paper))]',
            sizes[size],
            overlap[size],
          )}
          aria-hidden={label ? true : undefined}
        >
          +{extra}
        </span>
      )}
    </div>
  )
}
