import { sheetDismiss, springs } from '@potluck/tokens'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react'
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { IconButton } from './button'
import { cn } from './cn'
import { useIsDesktop, usePrefersReducedMotion } from './hooks'

interface SheetContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const SheetContext = createContext<SheetContextValue | null>(null)

function useSheetContext(component: string): SheetContextValue {
  const ctx = useContext(SheetContext)
  if (!ctx) throw new Error(`${component} must be used inside <Sheet> or <Dialog>`)
  return ctx
}

export interface SheetProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}

/**
 * Modal root. Controlled (`open` + `onOpenChange`) or uncontrolled
 * (`defaultOpen`, plus a `SheetTrigger`). Focus is trapped and restored, Escape
 * and the scrim close it.
 */
export function Sheet({ open: openProp, defaultOpen = false, onOpenChange, children }: SheetProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : uncontrolled
  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setUncontrolled(next)
      onOpenChange?.(next)
    },
    [controlled, onOpenChange],
  )
  return (
    <SheetContext.Provider value={{ open, setOpen }}>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        {children}
      </DialogPrimitive.Root>
    </SheetContext.Provider>
  )
}

export const SheetTrigger = DialogPrimitive.Trigger
export const SheetClose = DialogPrimitive.Close

export interface SheetContentProps {
  /** Visible heading, also the dialog's accessible name. */
  title: ReactNode
  description?: ReactNode
  /** Keep the title for screen readers only. */
  hideTitle?: boolean
  /** Accessible name of the close button, e.g. "Close". */
  closeLabel: string
  /**
   * `auto` (default) is a bottom sheet on phones and a centered dialog from
   * md up. Force one with `sheet` or `dialog`.
   */
  variant?: 'auto' | 'sheet' | 'dialog'
  /** Sticky footer for the primary action. */
  footer?: ReactNode
  /** Max width on desktop. */
  size?: 'sm' | 'md' | 'lg'
  className?: string
  children?: ReactNode
}

const widths = { sm: 'md:max-w-sm', md: 'md:max-w-lg', lg: 'md:max-w-2xl' } as const

export function SheetContent({
  title,
  description,
  hideTitle,
  closeLabel,
  variant = 'auto',
  footer,
  size = 'md',
  className,
  children,
}: SheetContentProps) {
  const { open, setOpen } = useSheetContext('SheetContent')
  const isDesktop = useIsDesktop()
  const reduced = usePrefersReducedMotion()
  const dragControls = useDragControls()
  const asSheet = variant === 'sheet' || (variant === 'auto' && !isDesktop)
  // Where focus was when it opened. A controlled sheet has no Radix trigger to go back to, so
  // closing (Escape, the scrim, the close button) would drop focus on the body; send it back here.
  const returnTo = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    const active = document.activeElement
    returnTo.current = active instanceof HTMLElement && active !== document.body ? active : null
  }, [open])
  const onCloseAutoFocus = (event: Event) => {
    const target = returnTo.current
    if (target?.isConnected) {
      event.preventDefault()
      target.focus()
    }
  }

  const startDrag = (event: ReactPointerEvent) => {
    if (asSheet && !reduced) dragControls.start(event)
  }

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > sheetDismiss.distance || info.velocity.y > sheetDismiss.velocity) {
      setOpen(false)
    }
  }

  const motionProps = reduced
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.15 },
      }
    : asSheet
      ? {
          initial: { y: '100%' },
          animate: { y: 0 },
          exit: { y: '100%' },
          transition: springs.gentle,
        }
      : {
          initial: { opacity: 0, scale: 0.96, y: 12 },
          animate: { opacity: 1, scale: 1, y: 0 },
          exit: { opacity: 0, scale: 0.97, y: 8 },
          transition: springs.default,
        }

  return (
    <AnimatePresence>
      {open && (
        <DialogPrimitive.Portal forceMount>
          <DialogPrimitive.Overlay asChild forceMount>
            <motion.div
              className="fixed inset-0 z-50 bg-scrim backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            />
          </DialogPrimitive.Overlay>
          <div
            className={cn(
              'pointer-events-none fixed inset-0 z-50 flex',
              asSheet ? 'items-end' : 'items-center justify-center p-6',
            )}
          >
            <DialogPrimitive.Content
              asChild
              forceMount
              onCloseAutoFocus={onCloseAutoFocus}
              // Opt out of Radix's missing-description warning when there is none.
              {...(description ? {} : { 'aria-describedby': undefined })}
            >
              <motion.div
                {...motionProps}
                drag={asSheet && !reduced ? 'y' : false}
                dragControls={dragControls}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0.04, bottom: 0.8 }}
                onDragEnd={onDragEnd}
                className={cn(
                  'pointer-events-auto relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-card text-ink shadow-sheet outline-none',
                  asSheet
                    ? 'rounded-t-sheet border-t border-line pb-safe'
                    : cn('max-h-[85dvh] rounded-sheet border border-line', widths[size]),
                  className,
                )}
              >
                <div
                  onPointerDown={startDrag}
                  className={cn(
                    'relative shrink-0 px-5 pt-3 pb-2',
                    asSheet && !reduced && 'cursor-grab touch-none active:cursor-grabbing',
                  )}
                >
                  {asSheet && (
                    <div
                      aria-hidden
                      className="mx-auto mb-3 h-1.5 w-10 rounded-pill bg-line-strong"
                    />
                  )}
                  <div className={cn('flex items-start gap-3', !asSheet && 'pt-3')}>
                    <div className="min-w-0 flex-1">
                      <DialogPrimitive.Title
                        className={cn(
                          'text-xl font-bold tracking-tight text-balance',
                          hideTitle && 'sr-only',
                        )}
                      >
                        {title}
                      </DialogPrimitive.Title>
                      {description && (
                        <DialogPrimitive.Description className="mt-1 text-sm text-mute">
                          {description}
                        </DialogPrimitive.Description>
                      )}
                    </div>
                    <DialogPrimitive.Close asChild>
                      <IconButton
                        label={closeLabel}
                        icon={<X />}
                        size="sm"
                        variant="ghost"
                        className="-mt-1 -mr-2 bg-sunken"
                      />
                    </DialogPrimitive.Close>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
                  {children}
                </div>
                {footer && (
                  <div className="shrink-0 border-t border-line bg-card px-5 py-3">{footer}</div>
                )}
              </motion.div>
            </DialogPrimitive.Content>
          </div>
        </DialogPrimitive.Portal>
      )}
    </AnimatePresence>
  )
}
