import { cn } from '@potluck/ui'
import { Link, type LinkProps } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

const tones = {
  plum: 'bg-plum-soft text-plum-ink',
  olive: 'bg-olive-soft text-olive-ink',
  tomato: 'bg-tomato-soft text-tomato-ink',
  saffron: 'bg-saffron-soft text-saffron-ink',
} as const

/** A card-like row that opens another screen: icon, title, one line of help, chevron. */
export function NavRow({
  icon,
  title,
  hint,
  tone = 'plum',
  className,
  ...link
}: LinkProps & {
  icon: ReactNode
  title: string
  hint: string
  tone?: keyof typeof tones
  className?: string
}) {
  return (
    <Link
      {...link}
      className={cn(
        'flex items-center gap-3 rounded-card border border-line bg-card px-4 py-3 transition-colors hover:border-ink/30',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-full [&_svg]:size-5',
          tones[tone],
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block truncate text-sm text-mute">{hint}</span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-mute" />
    </Link>
  )
}
