import type { ReactNode } from 'react'
import { cn } from './cn'

export interface EmptyStateProps {
  /** Serif italic headline with some personality: "Nobody owes anybody." */
  title: ReactNode
  description?: ReactNode
  /** Illustration or big emoji. Decorative. */
  illustration?: ReactNode
  /** The one clear next step. */
  action?: ReactNode
  /** Heading level for the title; `h1` when the empty state is the whole page. */
  as?: 'h1' | 'h2' | 'h3'
  align?: 'center' | 'start'
  className?: string
}

export function EmptyState({
  title,
  description,
  illustration,
  action,
  as: Heading = 'h2',
  align = 'center',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 px-6 py-10',
        align === 'center' ? 'items-center text-center' : 'items-start text-left',
        className,
      )}
    >
      {illustration && (
        <div aria-hidden className="mb-2 text-6xl leading-none select-none">
          {illustration}
        </div>
      )}
      <Heading className="max-w-[18ch] flourish text-3xl leading-[1.05] text-ink sm:text-4xl">
        {title}
      </Heading>
      {description && <p className="max-w-[34ch] text-[0.9375rem] text-mute">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
