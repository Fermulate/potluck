import { Card, cn } from '@potluck/ui'
import type { ReactNode } from 'react'

/** A titled card on the Me page, the same frame as its other sections. */
export function SettingsSection({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <h2 id={id} className="text-sm font-bold text-mute">
        {title}
      </h2>
      <Card padding="roomy" className="grid grid-cols-[minmax(0,1fr)]">
        {children}
      </Card>
    </section>
  )
}

/**
 * One setting: an icon, what it is, where it stands, then the buttons that change it, always on
 * their own line so every row reads the same at any width. Rows after the first get a hairline
 * above, like the courses on a menu.
 */
export function SettingsRow({
  icon,
  label,
  status,
  value,
  action,
  children,
  className,
}: {
  icon: ReactNode
  label: string
  /** A badge next to the label. */
  status?: ReactNode
  value?: ReactNode
  action?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 py-5 first:pt-0 last:pb-0 [&+&]:border-t [&+&]:border-line',
        className,
      )}
    >
      <span
        aria-hidden
        className="grid size-10 place-items-center rounded-full bg-sunken text-ink [&_svg]:size-[1.125rem]"
      >
        {icon}
      </span>
      <div className="grid min-w-0 gap-3 pt-0.5">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {label}
            {status}
          </p>
          {value && <div className="mt-0.5 text-sm break-words text-mute">{value}</div>}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
        {children}
      </div>
    </div>
  )
}
