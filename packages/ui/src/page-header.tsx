import type { ReactNode } from 'react'
import { cn } from './cn'

export interface PageHeaderProps {
  title: ReactNode
  /** Serif italic line above the title: a greeting or a date. */
  flourish?: ReactNode
  /** Supporting line under the title. */
  subtitle?: ReactNode
  /** Back button or close button on the left. */
  leading?: ReactNode
  /** Icon buttons or a small action on the right. */
  actions?: ReactNode
  /** `large` for top-level screens, `compact` for detail views. */
  size?: 'large' | 'compact'
  className?: string
}

export function PageHeader({
  title,
  flourish,
  subtitle,
  leading,
  actions,
  size = 'large',
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-2 pt-safe', className)}>
      {(leading || (actions && size === 'compact')) && (
        <div className="-mx-2 flex min-h-11 items-center justify-between gap-2">
          <div className="flex items-center">{leading}</div>
          {size === 'compact' && <div className="flex items-center gap-1">{actions}</div>}
        </div>
      )}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {flourish && <p className="mb-1 flourish text-xl text-mute">{flourish}</p>}
          <h1
            className={cn(
              'font-display leading-[0.95] tracking-[-0.02em] text-ink',
              size === 'large' ? 'text-5xl sm:text-6xl' : 'text-3xl sm:text-4xl',
            )}
          >
            {title}
          </h1>
          {subtitle && <p className="mt-2 text-[0.9375rem] text-mute">{subtitle}</p>}
        </div>
        {size === 'large' && actions && (
          <div className="flex shrink-0 items-center gap-1 pb-1">{actions}</div>
        )}
      </div>
    </header>
  )
}
