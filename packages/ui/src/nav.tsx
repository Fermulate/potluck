import { springs } from '@potluck/tokens'
import { Plus } from 'lucide-react'
import { motion } from 'motion/react'
import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn'
import { usePrefersReducedMotion } from './hooks'

export interface NavItem {
  id: string
  label: string
  /** Outline icon. */
  icon: ReactNode
  /** Filled or bolder icon for the active state. Falls back to `icon`. */
  activeIcon?: ReactNode
  href: string
  /** Small count or dot, e.g. requests waiting on you. */
  badge?: number | boolean
}

export interface NavLinkRenderProps {
  href: string
  className: string
  'aria-current': 'page' | undefined
  'aria-label'?: string
  children: ReactNode
}

/** Render prop so the app can use its router's Link. Defaults to `<a>`. */
export type RenderNavLink = (props: NavLinkRenderProps) => ReactNode

const defaultLink: RenderNavLink = ({ children, ...props }) => <a {...props}>{children}</a>

function Badge({ value }: { value: number | boolean }) {
  if (value === false || value === 0) return null
  return (
    <span
      aria-hidden
      className={cn(
        'absolute -top-1 left-[calc(50%+0.375rem)] grid place-items-center rounded-pill bg-tomato-strong font-bold text-on-tomato tabular ring-2 ring-paper',
        value === true ? 'size-2.5' : 'h-[1.125rem] min-w-[1.125rem] px-1 text-[0.625rem]',
      )}
    >
      {value === true ? null : value > 99 ? '99+' : value}
    </span>
  )
}

/**
 * The count for screen readers. It lives in the link text (not an `aria-label`) so the
 * accessible name still starts with the visible label, which voice control relies on.
 */
function BadgeText({ badge }: { badge: NavItem['badge'] }) {
  if (typeof badge !== 'number' || badge <= 0) return null
  return (
    <>
      {' '}
      <span className="sr-only">({badge})</span>
    </>
  )
}

export interface BottomTabBarProps {
  items: NavItem[]
  activeId: string
  /** The raised center action, usually an `AddButton`. Sits between halves. */
  centerAction?: ReactNode
  renderLink?: RenderNavLink
  /** Accessible name of the nav landmark, e.g. "Main". */
  label: string
  className?: string
}

/** Mobile bottom navigation. Hidden from `lg` up, where `SideRail` takes over. */
export function BottomTabBar({
  items,
  activeId,
  centerAction,
  renderLink = defaultLink,
  label,
  className,
}: BottomTabBarProps) {
  const half = Math.ceil(items.length / 2)
  const pillId = useId()
  const reduced = usePrefersReducedMotion()
  const renderItem = (item: NavItem) => {
    const active = item.id === activeId
    return (
      <li key={item.id} className="flex flex-1 justify-center">
        {renderLink({
          href: item.href,
          'aria-current': active ? 'page' : undefined,
          className: cn(
            'relative flex h-14 w-full max-w-24 flex-col items-center justify-center gap-1 rounded-card text-[0.6875rem] font-semibold transition-colors duration-150 [&_svg]:size-6',
            active ? 'text-ink' : 'text-mute hover:text-ink',
          ),
          children: (
            <>
              <span className="relative inline-flex">
                {active && (
                  <motion.span
                    layoutId={pillId}
                    aria-hidden
                    className="absolute -inset-x-3.5 -inset-y-1 -z-10 rounded-pill bg-saffron-soft"
                    transition={reduced ? { duration: 0 } : springs.snappy}
                  />
                )}
                {active ? (item.activeIcon ?? item.icon) : item.icon}
              </span>
              <span>
                {item.label}
                <BadgeText badge={item.badge} />
              </span>
              {item.badge !== undefined && <Badge value={item.badge} />}
            </>
          ),
        })}
      </li>
    )
  }
  return (
    <nav
      aria-label={label}
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/88 pb-safe backdrop-blur-xl backdrop-saturate-150 lg:hidden',
        className,
      )}
    >
      <ul className="relative isolate mx-auto flex h-[4.25rem] max-w-xl items-center px-2">
        {items.slice(0, half).map(renderItem)}
        {centerAction && (
          <li className="flex shrink-0 justify-center px-1">
            <div className="-mt-7">{centerAction}</div>
          </li>
        )}
        {items.slice(half).map(renderItem)}
      </ul>
    </nav>
  )
}

export interface SideRailProps {
  items: NavItem[]
  activeId: string
  renderLink?: RenderNavLink
  label: string
  /** Wordmark or logo at the top. */
  brand?: ReactNode
  /** Primary action under the brand, e.g. an "Add" button. */
  action?: ReactNode
  /** Bottom slot, e.g. the signed-in person. */
  footer?: ReactNode
  className?: string
}

/** Desktop navigation rail, shown from `lg` up. */
export function SideRail({
  items,
  activeId,
  renderLink = defaultLink,
  label,
  brand,
  action,
  footer,
  className,
}: SideRailProps) {
  const pillId = useId()
  const reduced = usePrefersReducedMotion()
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh w-[15.5rem] shrink-0 flex-col gap-6 border-r border-line px-4 py-6 lg:flex',
        className,
      )}
    >
      {brand && <div className="px-2">{brand}</div>}
      {action && <div>{action}</div>}
      <nav aria-label={label}>
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const active = item.id === activeId
            return (
              <li key={item.id}>
                {renderLink({
                  href: item.href,
                  'aria-current': active ? 'page' : undefined,
                  className: cn(
                    'relative isolate flex h-11 items-center gap-3 rounded-pill px-3.5 text-[0.9375rem] font-semibold transition-colors duration-150 [&_svg]:size-5',
                    active ? 'text-ink' : 'text-mute hover:bg-ink/[0.04] hover:text-ink',
                  ),
                  children: (
                    <>
                      {active && (
                        <motion.span
                          layoutId={pillId}
                          aria-hidden
                          className="absolute inset-0 -z-10 rounded-pill bg-card ring-1 ring-line"
                          transition={reduced ? { duration: 0 } : springs.snappy}
                        />
                      )}
                      {active ? (item.activeIcon ?? item.icon) : item.icon}
                      <span className="flex-1">
                        {item.label}
                        <BadgeText badge={item.badge} />
                      </span>
                      {typeof item.badge === 'number' && item.badge > 0 && (
                        <span
                          aria-hidden
                          className="rounded-pill bg-tomato-strong px-1.5 text-xs leading-5 font-bold text-on-tomato tabular"
                        >
                          {item.badge}
                        </span>
                      )}
                      {item.badge === true && (
                        <span aria-hidden className="size-2 rounded-full bg-tomato" />
                      )}
                    </>
                  ),
                })}
              </li>
            )
          })}
        </ul>
      </nav>
      {footer && <div className="mt-auto">{footer}</div>}
    </aside>
  )
}

export interface AddButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name, e.g. "Add". */
  label: string
  /** Turns the plus into a cross while its menu is open. */
  open?: boolean
  size?: 'md' | 'lg'
}

/** The big tomato plus. Opens the quick-add sheet. */
export const AddButton = forwardRef<HTMLButtonElement, AddButtonProps>(function AddButton(
  { label, open = false, size = 'lg', className, type = 'button', ...props },
  ref,
) {
  const reduced = usePrefersReducedMotion()
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-expanded={props['aria-haspopup'] ? open : undefined}
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-tomato-strong text-on-tomato transition-transform duration-150 ease-out active:scale-95',
        'shadow-[inset_0_-3px_0_rgb(0_0_0/0.16),0_10px_24px_-8px_rgb(214_63_37/0.7)] ring-4 ring-paper',
        size === 'lg' ? 'size-16' : 'size-14',
        className,
      )}
      {...props}
    >
      <motion.span
        aria-hidden
        className="inline-flex"
        animate={{ rotate: open ? 135 : 0 }}
        transition={reduced ? { duration: 0 } : springs.default}
      >
        <Plus className={size === 'lg' ? 'size-8' : 'size-7'} strokeWidth={2.5} />
      </motion.span>
    </button>
  )
})
