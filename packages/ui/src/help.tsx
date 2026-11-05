import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { cn } from './cn'

const GUTTER = 16
const GAP = 8

/** The small ringed question mark both help affordances share. */
function Glyph() {
  return (
    <span
      aria-hidden
      className="grid size-[1.125rem] place-items-center rounded-full border-[1.5px] border-current font-display text-[0.875rem] leading-none italic"
    >
      <span className="-mt-px -ml-px">?</span>
    </span>
  )
}

const triggerClass =
  'group/help relative inline-flex shrink-0 items-center gap-1.5 rounded-pill p-1 -m-1 text-mute ' +
  'transition-colors duration-150 hover:text-ink aria-expanded:text-ink'

export interface HelpLinkProps {
  /** Full URL of the guide page. */
  href: string
  /** What the link explains, e.g. "How splits work". Shown as a tooltip, or inline with `showLabel`. */
  label: string
  /** Screen reader hint that the link opens a new tab. */
  newTabHint: string
  /** Show the label next to the icon instead of only on hover and focus. */
  showLabel?: boolean
  /** Which edge of the icon the tooltip lines up with. */
  align?: 'start' | 'end'
  className?: string
}

/** A "?" that opens a page of the user guide in a new tab. */
export function HelpLink({
  href,
  label,
  newTabHint,
  showLabel = false,
  align = 'end',
  className,
}: HelpLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className={cn(triggerClass, showLabel && 'm-0 p-0', className)}
    >
      <Glyph />
      {showLabel ? (
        <span className="text-sm font-semibold underline decoration-line-strong underline-offset-4 group-hover/help:decoration-current">
          {label} <span className="sr-only">({newTabHint})</span>
        </span>
      ) : (
        <>
          <span className="sr-only">
            {label} ({newTabHint})
          </span>
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute bottom-full z-30 mb-1.5 hidden rounded-pill bg-ink px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-paper shadow-pop',
              'group-hover/help:block group-focus-visible/help:block',
              align === 'end' ? 'right-0' : 'left-0',
            )}
          >
            {label}
          </span>
        </>
      )}
    </a>
  )
}

export interface HelpTipProps {
  /** Accessible name of the "?" button, e.g. "About simplified debts". */
  label: string
  /** Heading inside the popover. */
  title: string
  /** One or two short lines. */
  children: ReactNode
  /** Guide page for the full story. */
  href?: string
  readMoreLabel?: string
  newTabHint?: string
  /** Which edge of the button the popover lines up with. */
  align?: 'start' | 'end'
  className?: string
}

/**
 * A "?" that opens a small "Good to know" card with a line or two of explanation and a link to
 * the guide. Uses the browser popover (top layer, light dismiss, Escape), so it is never clipped
 * by a scrolling card.
 */
export function HelpTip({
  label,
  title,
  children,
  href,
  readMoreLabel,
  newTabHint,
  align = 'end',
  className,
}: HelpTipProps) {
  const id = useId()
  const panelId = `help${id}`
  const titleId = `${panelId}-title`
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const el = panel.current
    if (!el) return
    const onToggle = (event: Event) => setOpen((event as ToggleEvent).newState === 'open')
    el.addEventListener('toggle', onToggle)
    return () => el.removeEventListener('toggle', onToggle)
  }, [])

  const place = useCallback(() => {
    const button = trigger.current
    const el = panel.current
    if (!button || !el) return
    const rect = button.getBoundingClientRect()
    const width = el.offsetWidth
    const height = el.offsetHeight
    const preferred = align === 'end' ? rect.right - width : rect.left
    const left = Math.max(GUTTER, Math.min(preferred, window.innerWidth - width - GUTTER))
    const below = rect.bottom + GAP
    const top =
      below + height > window.innerHeight - GUTTER && rect.top - GAP - height >= GUTTER
        ? rect.top - GAP - height
        : below
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [align])

  useLayoutEffect(() => {
    if (!open) return
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  return (
    <span
      className={cn('inline-flex', className)}
      // Handled here so a surrounding page or sheet that also listens for Escape stays open.
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        event.preventDefault()
        panel.current?.hidePopover()
        trigger.current?.focus()
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        popoverTarget={panelId}
        className={triggerClass}
      >
        <Glyph />
      </button>
      <div
        ref={panel}
        id={panelId}
        popover="auto"
        aria-labelledby={titleId}
        role="note"
        className="fixed inset-auto m-0 w-72 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-card p-4 text-left text-ink shadow-pop"
      >
        <p id={titleId} className="text-sm font-bold">
          {title}
        </p>
        <div className="mt-1 text-sm leading-relaxed text-mute">{children}</div>
        {href && readMoreLabel && (
          <a
            href={href}
            target="_blank"
            rel="noopener"
            className="mt-2 inline-flex min-h-6 items-center text-sm font-semibold text-ink underline decoration-tomato decoration-2 underline-offset-4"
          >
            {readMoreLabel} {newTabHint && <span className="sr-only">({newTabHint})</span>}
          </a>
        )}
      </div>
    </span>
  )
}
